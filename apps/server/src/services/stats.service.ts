import { type GameDoc, GameModel } from '../models/game.model.js';
import { UserModel } from '../models/user.model.js';

interface Totals {
  points: number;
  wins: number;
  games: number;
}

// how many finished games are read to build totals
const GAMES_SAMPLE = 2000;

function addGame(totals: Totals, game: GameDoc, color: string): void {
  totals.points += game.scores?.[color] ?? 0;
  totals.wins += game.winners?.includes(color) ? 1 : 0;
  totals.games += 1;
}

export const StatsService = {
  async leaderboard(limit = 50) {
    const finished = await GameModel.recentFinished(GAMES_SAMPLE);
    const byUser = new Map<string, Totals & { userId: string; username: string }>();
    for (const game of finished) {
      for (const p of game.players) {
        if (p.ai || !p.userId) continue;
        const entry = byUser.get(p.userId) ?? { userId: p.userId, username: p.username, points: 0, wins: 0, games: 0 };
        addGame(entry, game, p.color);
        byUser.set(p.userId, entry);
      }
    }
    return [...byUser.values()].sort((a, b) => b.points - a.points || b.wins - a.wins).slice(0, limit);
  },

  async searchPlayers(query: string) {
    const found = await UserModel.searchActiveByUsername(query, 20);
    const ids = found.map((u) => u._id.toHexString());
    const stats = new Map<string, Totals>(ids.map((id) => [id, { points: 0, wins: 0, games: 0 }]));
    if (ids.length > 0) {
      for (const game of await GameModel.findFinishedByPlayers(ids, GAMES_SAMPLE)) {
        for (const p of game.players) {
          const totals = p.userId ? stats.get(p.userId) : undefined;
          if (totals) addGame(totals, game, p.color);
        }
      }
    }
    return found.map((u) => ({
      id: u._id.toHexString(),
      username: u.username,
      joinedAt: u.createdAt,
      ...stats.get(u._id.toHexString())!,
    }));
  },

  async adminOverview() {
    const [users, activeUsers, gamesTotal, gamesActive, gamesFinished] = await Promise.all([
      UserModel.count(),
      UserModel.count({ active: true }),
      GameModel.count(),
      GameModel.count({ status: 'active' }),
      GameModel.count({ status: 'finished' }),
    ]);
    return { users, activeUsers, gamesTotal, gamesActive, gamesFinished };
  },
};
