import type http from 'node:http';
import cors from 'cors';
import express, { type Express } from 'express';
import { config } from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestContext } from './middleware/requestContext.js';
import { apiRoutes } from './routes/index.js';
import type { LiveServices } from './services/live/index.js';
import { mountWebApp } from './web/index.js';

// The Express app with everything that runs before a route does.
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(requestContext);
  app.use(cors());
  app.use(express.json());
  return app;
}

// Order matters: API, then the web app (which answers every other path),
// then the error handler. Returns what to call on shutdown.
export async function mountRoutes(
  app: Express,
  server: http.Server,
  live: LiveServices,
): Promise<() => Promise<void>> {
  app.use('/api', apiRoutes(live.games));
  const closeWeb = await mountWebApp(app, server);
  app.use(errorHandler);
  return closeWeb;
}
