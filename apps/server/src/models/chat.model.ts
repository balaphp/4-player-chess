import type { Color } from '@four-chess/engine';
import { db, ObjectId } from '../db/mongo.js';

export interface ChatMessageDoc {
  _id: ObjectId;
  gameId: string;
  userId: string;
  username: string;
  color: Color; // the seat the sender plays
  text: string;
  at: Date;
}

export const CHAT_MAX_LENGTH = 300;
// messages outlive their game briefly, then MongoDB removes them by itself
const KEEP_SECONDS = 2 * 24 * 60 * 60;

const messages = () => db().collection<ChatMessageDoc>('chatMessages');

export const ChatModel = {
  async ensureIndexes(): Promise<void> {
    await messages().createIndex({ gameId: 1, at: 1 });
    await messages().createIndex({ at: 1 }, { expireAfterSeconds: KEEP_SECONDS });
  },

  async add(fields: Omit<ChatMessageDoc, '_id' | 'at'>): Promise<ChatMessageDoc> {
    const message: ChatMessageDoc = { _id: new ObjectId(), ...fields, at: new Date() };
    await messages().insertOne(message);
    return message;
  },

  // the latest messages of a game, oldest first
  async recent(gameId: string, limit: number): Promise<ChatMessageDoc[]> {
    const latest = await messages().find({ gameId }).sort({ at: -1 }).limit(limit).toArray();
    return latest.reverse();
  },
};
