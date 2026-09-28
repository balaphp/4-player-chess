import type { Request, Response } from 'express';
import { config } from '../config/index.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { userFromRequest } from '../middleware/auth.js';
import { GameModel } from '../models/game.model.js';
import { type UserDoc, UserModel } from '../models/user.model.js';
import { AuthService } from '../services/auth.service.js';
import type { GameService } from '../services/live/index.js';
import { StatsService } from '../services/stats.service.js';
import { gameHistoryView } from '../views/game.view.js';
import { userView } from '../views/user.view.js';

export function createAdminController(games: GameService) {
  return {
    async stats(_req: Request, res: Response) {
      res.json(await StatsService.adminOverview());
    },

    async users(_req: Request, res: Response) {
      res.json({ users: (await UserModel.list()).map(userView) });
    },

    async updateUser(req: Request, res: Response) {
      const id = String(req.params.id);
      if (!UserModel.isValidId(id)) throw badRequest('Invalid user id');
      if (id === req.user!.id) throw badRequest('Cannot modify your own account here');
      const { active, role } = req.body ?? {};
      const patch: Partial<Pick<UserDoc, 'active' | 'role'>> = {};
      if (typeof active === 'boolean') patch.active = active;
      if (role === 'user' || role === 'admin') patch.role = role;
      const user = await UserModel.update(id, patch);
      if (!user) throw notFound('User not found');
      req.log.info({ targetUserId: id, ...patch }, 'admin updated an account');
      res.json({ user: userView(user) });
    },

    async resetLink(req: Request, res: Response) {
      const id = String(req.params.id);
      const origin = req.get('origin') || `http://localhost:${config.port}`;
      const link = await AuthService.createResetLink(id, origin);
      req.log.info({ targetUserId: id }, 'admin created a password reset link');
      res.json(link);
    },

    async games(_req: Request, res: Response) {
      res.json({ games: (await GameModel.recent(200)).map(gameHistoryView) });
    },

    // live overview for the admin dashboard; answers 403 to anyone else,
    // signed in or not
    async live(req: Request, res: Response) {
      const user = await userFromRequest(req);
      if (!user || user.role !== 'admin') throw forbidden('Admin only');
      res.json(await games.liveOverview());
    },
  };
}
