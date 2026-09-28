import crypto from 'node:crypto';
import { chooseAIMove, type Color, FourChess, type Move, type PowerAction, seatColors } from '@four-chess/engine';
import type { Collection, Db } from 'mongodb';
import { GameError } from '../../lib/errors.js';
import { logger, type Logger } from '../../lib/logger.js';
import { type GameDoc, GAMES_COLLECTION } from '../../models/game.model.js';
import {
  LIVE_GAMES_COLLECTION,
  type LiveGameDoc,
  LOBBIES_COLLECTION,
  type LobbyDoc,
  seatColorOf,
} from '../../models/lobby.model.js';
import { liveGameAdminView, liveGameSummaryView, lobbyView } from '../../views/lobby.view.js';
import type { Broadcaster } from './broadcaster.js';
import { aiControl, requireHost } from './shared.js';

const CAS_RETRIES = 3;
const AI_DELAY = () => 650 + Math.random() * 550;
// a game whose AI hasn't moved for this long is picked up by any instance's sweeper
const SWEEP_STALE_MS = 8000;
const SWEEP_EVERY_MS = 5000;

// Games being played. All live state lives in MongoDB, so every server
// instance can serve every game. Actions are applied with a compare-and-swap
// on state.ply + state.rev: two instances racing on the same game resolve to
// exactly one winner, the loser just retries.
export class GameService {
  private readonly lobbies: Collection<LobbyDoc>;
  private readonly live: Collection<LiveGameDoc>;
  private readonly history: Collection<GameDoc>;
  private readonly aiTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly sweeper: ReturnType<typeof setInterval>;
  private readonly log: Logger = logger.child({ component: 'games' });

  constructor(
    db: Db,
    private readonly broadcast: Broadcaster,
  ) {
    this.lobbies = db.collection<LobbyDoc>(LOBBIES_COLLECTION);
    this.live = db.collection<LiveGameDoc>(LIVE_GAMES_COLLECTION);
    this.history = db.collection<GameDoc>(GAMES_COLLECTION);
    this.sweeper = setInterval(() => {
      this.sweepStalledAI().catch((err: unknown) => this.log.error({ err }, 'AI sweep failed'));
    }, SWEEP_EVERY_MS);
    this.sweeper.unref?.();
  }

  // stops background work so the process can exit cleanly
  stop(): void {
    clearInterval(this.sweeper);
    for (const timer of this.aiTimers.values()) clearTimeout(timer);
    this.aiTimers.clear();
  }

  // ---------- queries ----------

  get(gameId: string) {
    return this.live.findOne({ _id: gameId });
  }

  canWatch(g: LiveGameDoc, userId: string, role: 'user' | 'admin'): boolean {
    return role === 'admin' || g.open || g.playerIds.includes(userId);
  }

  async listFor(userId: string, role: 'user' | 'admin') {
    const filter = role === 'admin' ? {} : { $or: [{ open: true }, { playerIds: userId }] };
    const docs = await this.live.find(filter).sort({ startedAt: -1 }).limit(50).toArray();
    return docs.map(liveGameSummaryView);
  }

  // admin dashboard: everything in flight
  async liveOverview() {
    const [lobbies, games] = await Promise.all([
      this.lobbies.find().sort({ createdAt: -1 }).limit(100).toArray(),
      this.live.find().sort({ startedAt: -1 }).limit(100).toArray(),
    ]);
    return { lobbies: lobbies.map(lobbyView), games: games.map(liveGameAdminView) };
  }

  // ---------- lifecycle ----------

  async start(userId: string, lobbyId: string): Promise<LiveGameDoc> {
    const lobby = await requireHost(this.lobbies, userId, lobbyId);
    if (lobby.status !== 'waiting') throw new GameError('Game already in progress');
    const needed = seatColors(lobby.mode);
    const unfilled = needed.filter((c) => !lobby.seats[c]);
    if (unfilled.length > 0) {
      throw new GameError(`All ${needed.length} seats must be filled (empty: ${unfilled.join(', ')})`);
    }
    const engine = new FourChess(lobby.mode, lobby.powers);
    const game: LiveGameDoc = {
      _id: crypto.randomUUID().slice(0, 12),
      lobbyId: lobby._id,
      groupName: lobby.name,
      mode: lobby.mode,
      open: lobby.open,
      seats: JSON.parse(JSON.stringify(lobby.seats)),
      playerIds: [...lobby.memberIds],
      state: engine.toJSON(),
      startedAt: new Date(),
      updatedAt: new Date(),
    };
    await this.live.insertOne(game);
    await this.lobbies.updateOne({ _id: lobby._id }, { $set: { status: 'playing', gameId: game._id } });

    const players = needed.map((c) => {
      const s = game.seats[c]!;
      return s.kind === 'human'
        ? { color: c, userId: s.userId, username: s.username, ai: false }
        : { color: c, username: `AI (${s.difficulty})`, ai: true };
    });
    await this.history.insertOne({
      _id: game._id,
      mode: game.mode,
      status: 'active',
      groupName: lobby.name,
      players,
      winners: null,
      scores: null,
      movesCount: 0,
      startedAt: game.startedAt,
      endedAt: null,
    });
    this.log.info(
      {
        gameId: game._id,
        lobbyId: lobby._id,
        mode: game.mode,
        powers: lobby.powers,
        humans: players.filter((p) => !p.ai).length,
        ai: players.filter((p) => p.ai).length,
      },
      'game started',
    );

    this.broadcast.gameStarted(lobby._id, game._id);
    const after = await this.lobbies.findOne({ _id: lobby._id });
    if (after) this.broadcast.lobby(after);
    await this.broadcast.lobbyList();
    this.scheduleAI(game._id, game.state.ply);
    return game;
  }

  // Load -> apply -> compare-and-swap on ply + rev (powers bump rev without
  // touching ply). Any instance may run this for any game.
  private async apply(gameId: string, fn: (engine: FourChess, doc: LiveGameDoc) => void): Promise<LiveGameDoc> {
    for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
      const doc = await this.live.findOne({ _id: gameId });
      if (!doc) throw new GameError('Game not found or finished');
      const engine = FourChess.fromJSON(doc.state);
      fn(engine, doc); // throws on invalid action
      const newState = engine.toJSON();
      const res = await this.live.findOneAndUpdate(
        { _id: gameId, 'state.ply': doc.state.ply, 'state.rev': doc.state.rev ?? null },
        { $set: { state: newState, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      if (res) {
        this.broadcast.game(res);
        if (newState.winners) await this.finish(res, engine, 'finished');
        else this.scheduleAI(gameId, newState.ply);
        return res;
      }
      // someone else moved first: retry against the fresh state
      this.log.debug({ gameId, attempt: attempt + 1 }, 'concurrent update; retrying');
    }
    throw new GameError('The game is busy, try again');
  }

  private async finish(doc: LiveGameDoc, engine: FourChess, status: 'finished' | 'abandoned'): Promise<void> {
    const deleted = await this.live.deleteOne({ _id: doc._id });
    if (deleted.deletedCount === 0) return; // another instance already finished it
    const timer = this.aiTimers.get(doc._id);
    if (timer) clearTimeout(timer);
    this.aiTimers.delete(doc._id);
    await this.history.updateOne(
      { _id: doc._id },
      {
        $set: {
          status,
          winners: engine.winners ?? [],
          scores: engine.points,
          movesCount: engine.ply,
          endedAt: new Date(),
        },
      },
    );
    this.log.info(
      { gameId: doc._id, lobbyId: doc.lobbyId, status, winners: engine.winners ?? [], moves: engine.ply },
      'game ended',
    );
    await this.lobbies.updateOne({ _id: doc.lobbyId, gameId: doc._id }, { $set: { status: 'waiting', gameId: null } });
    const lobby = await this.lobbies.findOne({ _id: doc.lobbyId });
    if (lobby) this.broadcast.lobby(lobby);
    await this.broadcast.lobbyList();
    this.broadcast.gameOver(doc._id, { winners: engine.winners ?? [], eliminated: engine.eliminated });
  }

  // everyone has left the group: the game ends without a result
  async abandon(gameId: string): Promise<void> {
    const game = await this.live.findOne({ _id: gameId });
    if (game) await this.finish(game, FourChess.fromJSON(game.state), 'abandoned');
  }

  // ---------- player actions ----------

  // a seated human acting for themselves, not while autopilot holds the seat
  private actingColor(doc: LiveGameDoc, userId: string, verb: string): Color {
    const color = seatColorOf(doc.seats, userId);
    if (!color) throw new GameError('You are not playing in this game');
    const seat = doc.seats[color];
    if (seat?.kind === 'human' && seat.autopilot) {
      throw new GameError(`Autopilot is playing this seat — turn it off to ${verb} yourself`);
    }
    return color;
  }

  async move(userId: string, gameId: string, mv: Move): Promise<void> {
    await this.apply(gameId, (engine, doc) => {
      const res = engine.applyMove(this.actingColor(doc, userId, 'move'), mv);
      if (!res.ok) throw new GameError(res.error);
    });
  }

  async usePower(userId: string, gameId: string, action: PowerAction): Promise<void> {
    await this.apply(gameId, (engine, doc) => {
      const res = engine.applyPower(this.actingColor(doc, userId, 'act'), action);
      if (!res.ok) throw new GameError(res.error);
    });
  }

  async resign(userId: string, gameId: string): Promise<void> {
    const game = await this.live.findOne({ _id: gameId });
    if (!game) throw new GameError('Game not found or finished');
    const color = seatColorOf(game.seats, userId);
    if (!color) throw new GameError('You are not playing in this game');
    this.log.info({ gameId, userId, color }, 'player resigned');
    await this.resignSeat(gameId, color);
  }

  async resignSeat(gameId: string, color: Color): Promise<void> {
    await this.apply(gameId, (engine) => {
      engine.resign(color);
    });
  }

  async setAutopilot(userId: string, gameId: string, on: boolean): Promise<void> {
    const game = await this.live.findOne({ _id: gameId });
    if (!game) throw new GameError('Game not found or finished');
    const color = seatColorOf(game.seats, userId);
    if (!color) throw new GameError('You are not playing in this game');
    const res = await this.live.findOneAndUpdate(
      { _id: gameId },
      { $set: { [`seats.${color}.autopilot`]: on } },
      { returnDocument: 'after' },
    );
    if (!res) return;
    await this.lobbies.updateOne(
      { _id: res.lobbyId, [`seats.${color}.userId`]: userId },
      { $set: { [`seats.${color}.autopilot`]: on } },
    );
    this.broadcast.game(res);
    if (on) this.scheduleAI(res._id, res.state.ply);
  }

  // ---------- AI turns ----------

  // The instance that applied the last action schedules the AI reply locally;
  // the compare-and-swap makes a duplicate attempt from another one harmless.
  private scheduleAI(gameId: string, expectedPly: number, delay = AI_DELAY()): void {
    const existing = this.aiTimers.get(gameId);
    if (existing) clearTimeout(existing);
    this.aiTimers.set(
      gameId,
      setTimeout(() => {
        this.aiTimers.delete(gameId);
        this.aiTurn(gameId, expectedPly).catch((err: unknown) => this.log.error({ gameId, err }, 'AI turn failed'));
      }, delay),
    );
  }

  private async aiTurn(gameId: string, expectedPly: number): Promise<void> {
    const doc = await this.live.findOne({ _id: gameId });
    if (!doc || doc.state.ply !== expectedPly || doc.state.winners) return;
    const ctrl = aiControl(doc.seats[doc.state.turn]);
    if (!ctrl) return;
    try {
      await this.apply(gameId, (engine, fresh) => {
        if (engine.ply !== expectedPly) throw new GameError('stale'); // someone moved meanwhile
        const turn = engine.turn;
        if (!aiControl(fresh.seats[turn])) throw new GameError('not an AI turn');
        const mv = chooseAIMove(engine, turn, ctrl.difficulty);
        if (mv) {
          const res = engine.applyMove(turn, mv);
          if (!res.ok) {
            this.log.warn({ gameId, color: turn, reason: res.error }, 'AI chose an illegal move; resigning its seat');
            engine.resign(turn);
          }
        } else {
          engine.resign(turn);
        }
      });
    } catch (err) {
      // losing a race to a player or another instance is normal; anything else is not
      if (!(err instanceof GameError)) throw err;
      this.log.debug({ gameId, reason: err.message }, 'AI turn skipped');
    }
  }

  // Any instance picks up AI turns whose owner died (deploys, crashes).
  private async sweepStalledAI(): Promise<void> {
    const stale = await this.live
      .find({ updatedAt: { $lt: new Date(Date.now() - SWEEP_STALE_MS) } })
      .limit(10)
      .toArray();
    for (const doc of stale) {
      if (doc.state.winners) continue;
      if (!aiControl(doc.seats[doc.state.turn])) continue;
      await this.aiTurn(doc._id, doc.state.ply);
    }
  }
}
