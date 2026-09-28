import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function apiNotFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

// Expected failures answer with their own status and message; anything else
// is a bug: logged in full, answered with a generic 500.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body' });
    return;
  }
  (req.log ?? logger).error({ err, method: req.method, path: req.originalUrl.split('?')[0] }, 'unhandled error');
  res.status(500).json({ error: 'Internal server error' });
}
