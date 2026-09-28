import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';

// mounted at /api/auth
export const authRoutes = Router()
  .post('/signup', asyncHandler(AuthController.signup))
  .post('/login', asyncHandler(AuthController.login))
  .get('/me', requireAuth, asyncHandler(AuthController.me))
  .post('/forgot', asyncHandler(AuthController.forgot))
  .post('/reset', asyncHandler(AuthController.reset))
  .post('/change-password', requireAuth, asyncHandler(AuthController.changePassword));
