import type { NextFunction, Request, Response } from 'express';
import { authenticate, type AuthUser } from '../services/auth.service.js';

export function userFromRequest(req: Request): Promise<AuthUser | null> {
  const header = req.headers.authorization ?? '';
  return authenticate(header.startsWith('Bearer ') ? header.slice(7) : '');
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  userFromRequest(req)
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      req.user = user;
      req.log = req.log.child({ userId: user.id });
      next();
    })
    .catch(next);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Admin only' });
      return;
    }
    next();
  });
}
