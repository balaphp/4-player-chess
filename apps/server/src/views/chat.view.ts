import type { ChatMessageDoc } from '../models/chat.model.js';

export const chatMessageView = (m: ChatMessageDoc) => ({
  id: m._id.toHexString(),
  gameId: m.gameId,
  userId: m.userId,
  username: m.username,
  color: m.color,
  text: m.text,
  at: m.at.getTime(),
});
