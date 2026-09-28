import { seatColorOf } from '../models/lobby.model.js';
import type { SocketContext } from './context.js';

// WebRTC signalling relay for in-game voice/video: envelopes are only passed
// between seated humans of the same game; media itself flows peer-to-peer.
export function registerRtcHandlers({ io, socket, user, games, log }: SocketContext): void {
  socket.on('rtc:signal', async (payload: { gameId?: unknown; to?: unknown; data?: unknown }) => {
    const gameId = String(payload?.gameId ?? '');
    const to = String(payload?.to ?? '');
    try {
      const game = await games.get(gameId);
      if (!game) return;
      if (!seatColorOf(game.seats, user.id)) return;
      if (!seatColorOf(game.seats, to)) return;
      io.to(`user:${to}`).emit('rtc:signal', { gameId: game._id, from: user.id, data: payload.data });
    } catch (err) {
      // a bad signal must not take the connection down
      log.debug({ event: 'rtc:signal', gameId, err }, 'signal dropped');
    }
  });
}
