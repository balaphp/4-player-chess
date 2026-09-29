import { seatColors } from '@four-chess/engine';
import type { Collection } from 'mongodb';
import type { Server } from 'socket.io';
import type { LiveGameDoc, LobbyDoc } from '../../models/lobby.model.js';
import { liveGameView, lobbyView, privateGameView } from '../../views/lobby.view.js';

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

  // The shared state to the whole game, and to each player what only they may
  // see. Given the game as it was `before`, only those whose view changed hear
  // of it: a message by itself would tell the others a power was just used.
  game(g: LiveGameDoc, before?: LiveGameDoc): void {
    const changed = <T>(view: (doc: LiveGameDoc) => T): T | null => {
      const now = view(g);
      return before && JSON.stringify(view(before)) === JSON.stringify(now) ? null : now;
    };
    const shared = changed(liveGameView);
    if (shared) this.io.to(`game:${g._id}`).emit('game:state', shared);
    if (!g.state.powersEnabled) return;
    for (const c of seatColors(g.mode)) {
      const seat = g.seats[c];
      if (seat?.kind !== 'human') continue;
      const mine = changed((doc) => privateGameView(doc, c));
      if (mine) this.io.to(`user:${seat.userId}`).emit('game:private', mine);
    }
  }

  gameStarted(lobbyId: string, gameId: string): void {
    this.io.to(`lobby:${lobbyId}`).emit('game:started', { gameId });
  }

  gameOver(gameId: string, result: { winners: unknown; eliminated: unknown }): void {
    this.io.to(`game:${gameId}`).emit('game:over', result);
  }
}
