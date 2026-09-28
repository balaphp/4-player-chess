import { Router } from 'express';
import { createAdminController } from '../controllers/admin.controller.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAdmin } from '../middleware/auth.js';
import type { GameService } from '../services/live/index.js';

// mounted at /api/admin
export function adminRoutes(games: GameService): Router {
  const admin = createAdminController(games);
  return Router()
    .use(requireAdmin)
    .get('/stats', asyncHandler(admin.stats))
    .get('/users', asyncHandler(admin.users))
    .patch('/users/:id', asyncHandler(admin.updateUser))
    .post('/users/:id/reset-link', asyncHandler(admin.resetLink))
    .get('/games', asyncHandler(admin.games));
}
