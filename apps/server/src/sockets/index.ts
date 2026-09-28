import type http from 'node:http';
import { createAdapter } from '@socket.io/mongo-adapter';
import type { Db } from 'mongodb';
import { Server, type Socket } from 'socket.io';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { authenticate, type AuthUser } from '../services/auth.service.js';
import type { LiveServices } from '../services/live/index.js';
import { liveGameView, lobbyView, privateTrapsFor } from '../views/lobby.view.js';
import { registerChatHandlers } from './chat.handlers.js';
import { createRegister, type SocketContext } from './context.js';
import { registerGameHandlers } from './game.handlers.js';
import { registerLobbyHandlers } from './lobby.handlers.js';
import { registerRtcHandlers } from './rtc.handlers.js';

const log = logger.child({ component: 'sockets' });

const ADAPTER_COLLECTION = 'socket.io-events';
// reloads get a moment before the seat is marked disconnected
const DISCONNECT_GRACE_MS = 2000;

function clientIp(socket: Socket): string {
  if (config.trustProxy) {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return socket.handshake.address;
}

export async function createSocketServer(server: http.Server, db: Db): Promise<Server> {
  // In dev the live-reload WebSocket shares this listener; by default
  // Socket.IO closes any upgrade request that is not its own.
  const io = new Server(server, { cors: { origin: true }, destroyUpgrade: !config.webDev });

  // Cross-instance broadcast fan-out over a capped collection + change
  // streams: io.to(room).emit(...) reaches sockets on every instance.
  try {
    await db.createCollection(ADAPTER_COLLECTION, { capped: true, size: 1_000_000 });
  } catch {
    // already exists
  }
  // tailing an empty capped collection is unreliable: make sure it never is
  await db.collection(ADAPTER_COLLECTION).insertOne({ placeholder: true, createdAt: new Date() });
  io.adapter(createAdapter(db.collection(ADAPTER_COLLECTION)));

  io.use((socket, next) => {
    authenticate(String(socket.handshake.auth?.token ?? ''))
      .then((user) => {
        if (!user) {
          log.warn({ socketId: socket.id, ip: clientIp(socket) }, 'connection refused: not authenticated');
          return next(new Error('Not authenticated'));
        }
        socket.data.user = user;
        next();
      })
      .catch((err: unknown) => {
        log.error({ err, socketId: socket.id }, 'could not authenticate the connection');
        next(new Error('Something went wrong'));
      });
  });

  return io;
}

export function registerSocketHandlers(io: Server, { lobbies, games }: LiveServices): void {
  io.on('connection', async (socket) => {
    const user = socket.data.user as AuthUser;
    const ctx: SocketContext = {
      io,
      socket,
      user,
      lobbies,
      games,
      log: logger.child({ socketId: socket.id, ip: clientIp(socket), userId: user.id }),
    };
    ctx.log.info({ username: user.username }, 'connected');

    // handlers first, so nothing a client sends while the session is being
    // restored is missed
    const on = createRegister(ctx);
    registerLobbyHandlers(ctx, on);
    registerGameHandlers(ctx, on);
    registerChatHandlers(ctx, on);
    registerRtcHandlers(ctx);

    socket.on('disconnect', (reason) => {
      ctx.log.info({ reason }, 'disconnected');
      setTimeout(() => {
        const stillConnected = (io.sockets.adapter.rooms.get(`user:${user.id}`)?.size ?? 0) > 0;
        if (!stillConnected) {
          lobbies
            .setConnected(user.id, false)
            .catch((err: unknown) => ctx.log.error({ err }, 'could not mark the seat disconnected'));
        }
      }, DISCONNECT_GRACE_MS);
    });

    try {
      socket.join(`user:${user.id}`);
      lobbies
        .setConnected(user.id, true)
        .catch((err: unknown) => ctx.log.error({ err }, 'could not mark the seat connected'));

      // If the user already sits in a group (page reload), put the socket back in its rooms.
      const existing = await lobbies.findOfUser(user.id);
      if (existing) {
        socket.join(`lobby:${existing._id}`);
        if (existing.gameId) socket.join(`game:${existing.gameId}`);
        const game = existing.gameId ? await games.get(existing.gameId) : null;
        socket.emit('session:restore', {
          lobby: lobbyView(existing),
          game: game ? liveGameView(game) : null,
          myTraps: game ? privateTrapsFor(game, user.id) : [],
        });
        ctx.log.debug({ lobbyId: existing._id, gameId: existing.gameId }, 'session restored');
      }
      socket.emit('lobbies', await lobbies.listOpen());
    } catch (err) {
      ctx.log.error({ err }, 'could not restore the session');
    }
  });
}
