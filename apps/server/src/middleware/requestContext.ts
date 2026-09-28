import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger.js';

// Gives every request an id and a child logger carrying that id and the
// caller's IP (the auth middleware adds the userId), then logs one line when
// an API request finishes. Pages and assets are not logged.
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const started = performance.now();
  const incoming = req.headers['x-request-id'];
  req.id = (typeof incoming === 'string' && incoming.slice(0, 64)) || crypto.randomUUID().slice(0, 8);
  req.log = logger.child({ reqId: req.id, ip: req.ip });
  res.setHeader('x-request-id', req.id);

  // read now: routers rewrite req.url while a request passes through them
  const path = req.originalUrl.split('?')[0];
  if (path.startsWith('/api/')) {
    res.on('finish', () => {
      const line = { method: req.method, path, status: res.statusCode, ms: Math.round(performance.now() - started) };
      if (res.statusCode >= 500) req.log.error(line, 'request failed');
      else if (res.statusCode >= 400) req.log.warn(line, 'request refused');
      else if (path === '/api/health') req.log.debug(line, 'request');
      else req.log.info(line, 'request');
    });
  }
  next();
}
