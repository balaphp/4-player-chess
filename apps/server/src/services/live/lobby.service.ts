import crypto from 'node:crypto';
import { type AIDifficulty, type Color, type Mode, seatColors } from '@four-chess/engine';
import type { Collection, Db } from 'mongodb';
import { GameError } from '../../lib/errors.js';
import { logger, type Logger } from '../../lib/logger.js';
import { emptySeats, LOBBIES_COLLECTION, type LobbyDoc, seatColorOf, type SeatInfo } from '../../models/lobby.model.js';
import type { Broadcaster } from './broadcaster.js';
import type { GameService } from './game.service.js';
import { normalizeMode, requireHost } from './shared.js';

interface Player {
  id: string;
  username: string;
}

// Groups: where players gather, take seats and add AI before a game starts.
// Seat changes are guarded updates, so two people can never share a seat.
export class LobbyService {
  private readonly lobbies: Collection<LobbyDoc>;
  private readonly log: Logger = logger.child({ component: 'lobbies' });

  constructor(
    db: Db,
    private readonly broadcast: Broadcaster,
    private readonly games: GameService,
  ) {
    this.lobbies = db.collection<LobbyDoc>(LOBBIES_COLLECTION);
  }

  listOpen() {
    return this.broadcast.openLobbies();
  }

  findOfUser(userId: string) {
    return this.lobbies.findOne({ memberIds: userId });
  }

  private assertWaiting(lobby: LobbyDoc): void {
    if (lobby.status !== 'waiting') throw new GameError('Game already in progress');
  }

  private assertSeatExists(lobby: LobbyDoc, color: Color): void {
    if (!seatColors(lobby.mode).includes(color)) throw new GameError('That seat does not exist in this mode');
  }

  async create(user: Player, name: string, mode: Mode, open: boolean, autopilot = false, powers = false): Promise<LobbyDoc> {
    await this.leave(user.id);
    const lobby: LobbyDoc = {
      _id: crypto.randomUUID().slice(0, 8),
      name: name.trim().slice(0, 30) || `${user.username}'s group`,
      hostUserId: user.id,
      mode: normalizeMode(mode),
      powers,
      open,
      status: 'waiting',
      seats: emptySeats(),
      gameId: null,
      memberIds: [user.id],
      createdAt: new Date(),
    };
    lobby.seats.red = { kind: 'human', userId: user.id, username: user.username, connected: true, autopilot };
    await this.lobbies.insertOne(lobby);
    this.log.info({ lobbyId: lobby._id, userId: user.id, mode: lobby.mode, open, powers }, 'group created');
    await this.broadcast.lobbyList();
    return lobby;
  }

  async join(user: Player, lobbyId: string): Promise<LobbyDoc> {
    const existing = await this.lobbies.findOne({ _id: lobbyId });
    if (!existing) throw new GameError('Group not found');
    if (seatColorOf(existing.seats, user.id)) return existing; // already seated here
    this.assertWaiting(existing);
    await this.leave(user.id);
    // grab the first free seat with a guarded update so two joiners can't share one
    for (const c of seatColors(existing.mode)) {
      const seat: SeatInfo = { kind: 'human', userId: user.id, username: user.username, connected: true };
      const res = await this.lobbies.findOneAndUpdate(
        { _id: lobbyId, status: 'waiting', [`seats.${c}`]: null },
        { $set: { [`seats.${c}`]: seat }, $addToSet: { memberIds: user.id } },
        { returnDocument: 'after' },
      );
      if (res) {
        this.log.info({ lobbyId, userId: user.id, seat: c }, 'player joined group');
        this.broadcast.lobby(res);
        await this.broadcast.lobbyList();
        return res;
      }
    }
    throw new GameError('Group is full');
  }

  async sit(userId: string, lobbyId: string, color: Color): Promise<LobbyDoc> {
    const lobby = await this.lobbies.findOne({ _id: lobbyId });
    if (!lobby) throw new GameError('Group not found');
    this.assertWaiting(lobby);
    const current = seatColorOf(lobby.seats, userId);
    if (!current) throw new GameError('You are not in this group');
    this.assertSeatExists(lobby, color);
    const res = await this.lobbies.findOneAndUpdate(
      { _id: lobbyId, status: 'waiting', [`seats.${color}`]: null, [`seats.${current}.userId`]: userId },
      { $set: { [`seats.${color}`]: lobby.seats[current], [`seats.${current}`]: null } },
      { returnDocument: 'after' },
    );
    if (!res) throw new GameError('Seat is taken');
    this.broadcast.lobby(res);
    return res;
  }

  // Leaving mid-game resigns the seat; when the last player leaves, the group
  // closes and its game is abandoned.
  async leave(userId: string): Promise<void> {
    const lobby = await this.lobbies.findOne({ memberIds: userId });
    if (!lobby) return;
    const log = this.log.child({ lobbyId: lobby._id, userId });
    const color = seatColorOf(lobby.seats, userId);
    if (lobby.status === 'playing' && lobby.gameId && color) {
      await this.games
        .resignSeat(lobby.gameId, color)
        .catch((err: unknown) => log.debug({ gameId: lobby.gameId, err }, 'could not resign while leaving'));
    }
    const remaining = lobby.memberIds.filter((id) => id !== userId);
    if (remaining.length === 0) {
      if (lobby.gameId) await this.games.abandon(lobby.gameId);
      await this.lobbies.deleteOne({ _id: lobby._id });
      log.info('last player left; group closed');
    } else {
      const update: Record<string, unknown> = { memberIds: remaining };
      if (color) update[`seats.${color}`] = null;
      if (lobby.hostUserId === userId) update.hostUserId = remaining[0];
      const res = await this.lobbies.findOneAndUpdate({ _id: lobby._id }, { $set: update }, { returnDocument: 'after' });
      if (res) this.broadcast.lobby(res);
      log.info('player left group');
    }
    await this.broadcast.lobbyList();
  }

  async setMode(userId: string, lobbyId: string, mode: Mode): Promise<LobbyDoc> {
    const lobby = await requireHost(this.lobbies, userId, lobbyId);
    this.assertWaiting(lobby);
    const next = normalizeMode(mode);
    const seats = { ...lobby.seats };
    // seats that don't exist in the new mode are vacated (AI removed, humans moved)
    for (const c of Object.keys(seats) as Color[]) {
      if (seatColors(next).includes(c) || !seats[c]) continue;
      const seat = seats[c];
      seats[c] = null;
      if (seat?.kind === 'human') {
        const free = seatColors(next).find((sc) => !seats[sc]);
        if (free) seats[free] = seat;
      }
    }
    const res = await this.lobbies.findOneAndUpdate(
      { _id: lobbyId },
      { $set: { mode: next, seats } },
      { returnDocument: 'after' },
    );
    if (!res) throw new GameError('Group not found');
    this.broadcast.lobby(res);
    await this.broadcast.lobbyList();
    return res;
  }

  async setAI(userId: string, lobbyId: string, color: Color, on: boolean, difficulty: AIDifficulty): Promise<LobbyDoc> {
    const lobby = await requireHost(this.lobbies, userId, lobbyId);
    this.assertWaiting(lobby);
    this.assertSeatExists(lobby, color);
    let res: LobbyDoc | null;
    if (on) {
      res = await this.lobbies.findOneAndUpdate(
        { _id: lobbyId, [`seats.${color}`]: null },
        { $set: { [`seats.${color}`]: { kind: 'ai', difficulty: difficulty === 'easy' ? 'easy' : 'medium' } } },
        { returnDocument: 'after' },
      );
      if (!res) throw new GameError('Seat is taken');
    } else {
      res = await this.lobbies.findOneAndUpdate(
        { _id: lobbyId, [`seats.${color}.kind`]: 'ai' },
        { $set: { [`seats.${color}`]: null } },
        { returnDocument: 'after' },
      );
      if (!res) throw new GameError('No AI on that seat');
    }
    this.broadcast.lobby(res);
    await this.broadcast.lobbyList();
    return res;
  }

  async setAutopilot(userId: string, lobbyId: string, on: boolean): Promise<LobbyDoc> {
    const lobby = await this.lobbies.findOne({ _id: lobbyId });
    if (!lobby) throw new GameError('Group not found');
    const color = seatColorOf(lobby.seats, userId);
    if (!color) throw new GameError('You are not in this group');
    const res = await this.lobbies.findOneAndUpdate(
      { _id: lobbyId },
      { $set: { [`seats.${color}.autopilot`]: on } },
      { returnDocument: 'after' },
    );
    if (res) this.broadcast.lobby(res);
    return res ?? lobby;
  }

  // shown to the others in the group as online / offline
  async setConnected(userId: string, connected: boolean): Promise<void> {
    const lobby = await this.lobbies.findOne({ memberIds: userId });
    if (!lobby) return;
    const color = seatColorOf(lobby.seats, userId);
    if (!color) return;
    const res = await this.lobbies.findOneAndUpdate(
      { _id: lobby._id },
      { $set: { [`seats.${color}.connected`]: connected } },
      { returnDocument: 'after' },
    );
    if (res) this.broadcast.lobby(res);
  }
}
