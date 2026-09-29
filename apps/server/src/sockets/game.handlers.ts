import { GameError } from '../lib/errors.js';
import { liveGameView, privateGameViewFor } from '../views/lobby.view.js';
import type { Register, SocketContext } from './context.js';

// games in progress: watching, moving, powers, resigning
export function registerGameHandlers({ socket, user, games }: SocketContext, on: Register): void {
  socket.on('games:list', async (_payload: unknown, ack?: (games: unknown) => void) => {
    if (typeof ack === 'function') ack(await games.listFor(user.id, user.role));
  });

  on('game:join', async ({ gameId }) => {
    const game = await games.get(String(gameId ?? ''));
    if (!game) throw new GameError('Game not found');
    if (!games.canWatch(game, user.id, user.role)) throw new GameError('This game is in a private group');
    socket.join(`game:${game._id}`);
    return { game: liveGameView(game), mine: privateGameViewFor(game, user.id) };
  });

  on('game:move', async ({ gameId, from, to, promotion }) => {
    await games.move(user.id, String(gameId ?? ''), { from, to, promotion });
  });

  on('game:power', async ({ gameId, action }) => {
    await games.usePower(user.id, String(gameId ?? ''), action);
  });

  on('game:resign', async ({ gameId }) => {
    await games.resign(user.id, String(gameId ?? ''));
  });

  on('game:setAutopilot', async ({ gameId, on: enabled }) => {
    await games.setAutopilot(user.id, String(gameId ?? ''), enabled === true);
  });
}
