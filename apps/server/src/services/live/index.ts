import type { Db } from 'mongodb';
import type { Server } from 'socket.io';
import { LOBBIES_COLLECTION, type LobbyDoc } from '../../models/lobby.model.js';
import { Broadcaster } from './broadcaster.js';
import { GameService } from './game.service.js';
import { LobbyService } from './lobby.service.js';

// the services behind everything realtime: groups and the games played in them
export interface LiveServices {
  lobbies: LobbyService;
  games: GameService;
  stop(): void;
}

export function createLiveServices(io: Server, db: Db): LiveServices {
  const broadcast = new Broadcaster(io, db.collection<LobbyDoc>(LOBBIES_COLLECTION));
  const games = new GameService(db, broadcast);
  const lobbies = new LobbyService(db, broadcast, games);
  return { lobbies, games, stop: () => games.stop() };
}

export type { GameService, LobbyService };
