import { seatColors } from '@four-chess/engine';
import type { Collection } from 'mongodb';
import type { Server } from 'socket.io';
import type { LiveGameDoc, LobbyDoc } from '../../models/lobby.model.js';
import { liveGameView, lobbyView } from '../../views/lobby.view.js';

// Everything the server pushes to players. Emits fan out to every server
// instance through the Socket.IO mongo adapter.
export class Broadcaster {
  constructor(
    private readonly io: Server,
    private readonly lobbies: Collection<LobbyDoc>,
  ) {}

  async openLobbies() {
    const docs = await this.lobbies.find({ open: true, status: 'waiting' }).sort({ createdAt: -1 }).limit(50).toArray();
    return docs.map(lobbyView);
  }

  // the list of open groups, to everyone
  async lobbyList(): Promise<void> {
    this.io.emit('lobbies', await this.openLobbies());
  }

  lobby(l: LobbyDoc): void {
    this.io.to(`lobby:${l._id}`).emit('lobby:state', lobbyView(l));
  }

  // the shared state to the whole game, and each player's secret traps to that player only
  game(g: LiveGameDoc): void {
    this.io.to(`game:${g._id}`).emit('game:state', liveGameView(g));
    if (!g.state.powersEnabled) return;
    for (const c of seatColors(g.mode)) {
      const seat = g.seats[c];
      if (seat?.kind !== 'human') continue;
      this.io
        .to(`user:${seat.userId}`)
        .emit('game:private', { gameId: g._id, traps: (g.state.traps ?? []).filter((t) => t.color === c) });
    }
  }

  gameStarted(lobbyId: string, gameId: string): void {
    this.io.to(`lobby:${lobbyId}`).emit('game:started', { gameId });
  }

  gameOver(gameId: string, result: { winners: unknown; eliminated: unknown }): void {
    this.io.to(`game:${gameId}`).emit('game:over', result);
  }
}
