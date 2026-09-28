import type { Logger } from '../lib/logger.js';
import type { AuthUser } from '../services/auth.service.js';

declare global {
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
      user?: AuthUser;
    }
  }
}

export {};
