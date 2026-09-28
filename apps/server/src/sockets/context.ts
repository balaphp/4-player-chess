import type { Server, Socket } from 'socket.io';
import { GameError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { AuthUser } from '../services/auth.service.js';
import type { GameService, LobbyService } from '../services/live/index.js';

// what every handler of one connection shares
export interface SocketContext {
  io: Server;
  socket: Socket;
  user: AuthUser;
  lobbies: LobbyService;
  games: GameService;
  log: Logger; // carries socketId, ip and userId
}

type Ack = (res: { ok: boolean; error?: string; [k: string]: unknown }) => void;

// receives the payload and a logger that also carries the event and its game/group
export type Handler = (payload: any, log: Logger) => Promise<Record<string, unknown> | void>;

export type Register = (event: string, handler: Handler) => void;

const idsOf = (payload: any): { gameId?: string; lobbyId?: string } => ({
  ...(payload?.gameId ? { gameId: String(payload.gameId) } : {}),
  ...(payload?.lobbyId ? { lobbyId: String(payload.lobbyId) } : {}),
});

// Registers an acknowledged event. The client is answered { ok: true, ... }
// or { ok: false, error }: a refusal (GameError) passes its message on, any
// other failure is a bug and is logged in full.
export function createRegister(ctx: SocketContext): Register {
  return (event, handler) => {
    ctx.socket.on(event, async (payload: any, ack?: Ack) => {
      const started = performance.now();
      const log = ctx.log.child({ event, ...idsOf(payload) });
      const reply: Ack = (res) => {
        if (typeof ack === 'function') ack(res);
      };
      try {
        const extra = (await handler(payload ?? {}, log)) ?? {};
        reply({ ok: true, ...extra });
        log.debug({ ms: Math.round(performance.now() - started) }, 'event handled');
      } catch (err) {
        if (err instanceof GameError) {
          log.info({ reason: err.message }, 'event refused');
          reply({ ok: false, error: err.message });
        } else {
          log.error({ err }, 'event failed');
          reply({ ok: false, error: 'Something went wrong' });
        }
      }
    });
  };
}

export function leaveGroupRooms(socket: Socket): void {
  for (const room of [...socket.rooms]) {
    if (room.startsWith('lobby:') || room.startsWith('game:')) socket.leave(room);
  }
}
