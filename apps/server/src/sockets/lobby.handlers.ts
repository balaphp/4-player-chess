import { COLORS } from '@four-chess/engine';
import { GameError } from '../lib/errors.js';
import { lobbyView } from '../views/lobby.view.js';
import { leaveGroupRooms, type Register, type SocketContext } from './context.js';

const requireSeat = (color: unknown): void => {
  if (!COLORS.includes(color as (typeof COLORS)[number])) throw new GameError('Invalid seat');
};

// groups: creating, joining, seating, and starting the game
export function registerLobbyHandlers({ socket, user, lobbies, games }: SocketContext, on: Register): void {
  socket.on('lobby:list', async (_payload: unknown, ack?: (lobbies: unknown) => void) => {
    if (typeof ack === 'function') ack(await lobbies.listOpen());
  });

  on('lobby:create', async ({ name, mode, open, autopilot, powers }) => {
    const lobby = await lobbies.create(user, String(name ?? ''), mode, open !== false, autopilot === true, powers === true);
    leaveGroupRooms(socket);
    socket.join(`lobby:${lobby._id}`);
    return { lobby: lobbyView(lobby) };
  });

  on('lobby:join', async ({ lobbyId }) => {
    const lobby = await lobbies.join(user, String(lobbyId ?? ''));
    leaveGroupRooms(socket);
    socket.join(`lobby:${lobby._id}`);
    if (lobby.gameId) socket.join(`game:${lobby.gameId}`);
    return { lobby: lobbyView(lobby) };
  });

  on('lobby:leave', async () => {
    await lobbies.leave(user.id);
    leaveGroupRooms(socket);
  });

  on('lobby:sit', async ({ lobbyId, color }) => {
    requireSeat(color);
    return { lobby: lobbyView(await lobbies.sit(user.id, String(lobbyId), color)) };
  });

  on('lobby:setMode', async ({ lobbyId, mode }) => ({
    lobby: lobbyView(await lobbies.setMode(user.id, String(lobbyId), mode)),
  }));

  on('lobby:setAI', async ({ lobbyId, color, on: enabled, difficulty }) => {
    requireSeat(color);
    return { lobby: lobbyView(await lobbies.setAI(user.id, String(lobbyId), color, enabled !== false, difficulty)) };
  });

  on('lobby:setAutopilot', async ({ lobbyId, on: enabled }) => ({
    lobby: lobbyView(await lobbies.setAutopilot(user.id, String(lobbyId), enabled === true)),
  }));

  on('lobby:start', async ({ lobbyId }) => {
    const game = await games.start(user.id, String(lobbyId));
    socket.join(`game:${game._id}`);
    return { gameId: game._id };
  });
}
