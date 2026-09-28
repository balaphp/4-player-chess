import type { GameDoc } from '../models/game.model.js';

export const gameHistoryView = (g: GameDoc) => ({
  id: g._id,
  mode: g.mode,
  status: g.status,
  groupName: g.groupName,
  players: g.players,
  winners: g.winners,
  scores: g.scores,
  movesCount: g.movesCount,
  startedAt: g.startedAt,
  endedAt: g.endedAt,
});
