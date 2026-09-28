import { GameError } from '../lib/errors.js';
import { CHAT_MAX_LENGTH, ChatModel } from '../models/chat.model.js';
import { seatColorOf } from '../models/lobby.model.js';
import { chatMessageView } from '../views/chat.view.js';
import type { Register, SocketContext } from './context.js';

const HISTORY_LIMIT = 100;
// at most this many messages per connection in each window
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 6;

// In-game text chat. Players of the game write; everyone watching it reads.
export function registerChatHandlers({ io, user, games }: SocketContext, on: Register): void {
  let sentAt: number[] = [];

  on('chat:history', async ({ gameId }) => {
    const game = await games.get(String(gameId ?? ''));
    if (!game) throw new GameError('Game not found or finished');
    if (!games.canWatch(game, user.id, user.role)) throw new GameError('This game is in a private group');
    return { messages: (await ChatModel.recent(game._id, HISTORY_LIMIT)).map(chatMessageView) };
  });

  on('chat:send', async ({ gameId, text }) => {
    const body = String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, CHAT_MAX_LENGTH);
    if (!body) throw new GameError('Message is empty');

    const now = Date.now();
    sentAt = sentAt.filter((t) => now - t < RATE_WINDOW_MS);
    if (sentAt.length >= RATE_MAX) throw new GameError('You are sending messages too quickly');
    sentAt.push(now);

    const game = await games.get(String(gameId ?? ''));
    if (!game) throw new GameError('Game not found or finished');
    const color = seatColorOf(game.seats, user.id);
    if (!color) throw new GameError('Only players of this game can chat');

    const message = await ChatModel.add({
      gameId: game._id,
      userId: user.id,
      username: user.username,
      color,
      text: body,
    });
    io.to(`game:${game._id}`).emit('chat:message', chatMessageView(message));
  });
}
