import { Router } from 'express';
import { createAdminController } from '../controllers/admin.controller.js';
import { SystemController } from '../controllers/system.controller.js';
import { UserController } from '../controllers/user.controller.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { apiNotFound } from '../middleware/errorHandler.js';
import type { GameService } from '../services/live/index.js';
import { adminRoutes } from './admin.routes.js';
import { authRoutes } from './auth.routes.js';

// everything under /api
export function apiRoutes(games: GameService): Router {
  return Router()
    .get('/health', SystemController.health)
    .use('/auth', authRoutes)
    .get('/users/me/games', requireAuth, asyncHandler(UserController.myGames))
    .get('/players', requireAuth, asyncHandler(UserController.searchPlayers))
    .get('/leaderboard', requireAuth, asyncHandler(UserController.leaderboard))
    .get('/rtc/config', requireAuth, asyncHandler(SystemController.rtcConfig))
    .get('/live', asyncHandler(createAdminController(games).live))
    .use('/admin', adminRoutes(games))
    .use(apiNotFound);
}
