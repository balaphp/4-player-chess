import type { Request, Response } from 'express';
import { GameModel } from '../models/game.model.js';
import { StatsService } from '../services/stats.service.js';
import { gameHistoryView } from '../views/game.view.js';

export const UserController = {
  async myGames(req: Request, res: Response) {
    const games = await GameModel.findByPlayer(req.user!.id, 100);
    res.json({ games: games.map(gameHistoryView) });
  },

  async searchPlayers(req: Request, res: Response) {
    const query = String(req.query.q ?? '')
      .trim()
      .slice(0, 30);
    res.json({ players: query ? await StatsService.searchPlayers(query) : [] });
  },

  async leaderboard(_req: Request, res: Response) {
    res.json({ leaderboard: await StatsService.leaderboard() });
  },
};
