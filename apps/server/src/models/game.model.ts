import type { Filter } from 'mongodb';
import { db } from '../db/mongo.js';

// The permanent record of a game: who played, who won, the scores. The state
// of a game still being played lives in models/lobby.model.ts.

export interface GamePlayer {
  color: string;
  userId?: string; // ObjectId hex string; absent for AI seats
  username: string;
  ai: boolean;
}

export interface GameDoc {
  _id: string; // game id generated when the game starts
  mode: string;
  status: 'active' | 'finished' | 'abandoned';
  groupName: string | null;
  players: GamePlayer[];
  winners: string[] | null;
  scores: Record<string, number> | null;
  movesCount: number;
  startedAt: Date;
  endedAt: Date | null;
}

export const GAMES_COLLECTION = 'games';

const games = () => db().collection<GameDoc>(GAMES_COLLECTION);

export const GameModel = {
  async ensureIndexes(): Promise<void> {
    await games().createIndex({ startedAt: -1 });
    await games().createIndex({ 'players.userId': 1 });
  },

  findByPlayer: (userId: string, limit: number) =>
    games().find({ 'players.userId': userId }).sort({ startedAt: -1 }).limit(limit).toArray(),

  findFinishedByPlayers: (userIds: string[], limit: number) =>
    games()
      .find({ status: 'finished', 'players.userId': { $in: userIds } })
      .limit(limit)
      .toArray(),

  recentFinished: (limit: number) => games().find({ status: 'finished' }).sort({ startedAt: -1 }).limit(limit).toArray(),

  recent: (limit: number) => games().find().sort({ startedAt: -1 }).limit(limit).toArray(),

  count: (filter: Filter<GameDoc> = {}) => games().countDocuments(filter),
};
