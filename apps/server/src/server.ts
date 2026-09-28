import http from 'node:http';
import { createApp, mountRoutes } from './app.js';
import { config } from './config/index.js';
import { closeMongo, connectMongo } from './db/mongo.js';
import { prepareDatabase } from './db/setup.js';
import { logger } from './lib/logger.js';
import { mailEnabled } from './lib/mailer.js';
import { createLiveServices } from './services/live/index.js';
import { createSocketServer, registerSocketHandlers } from './sockets/index.js';

// Entry point: brings the pieces up in order, then waits for a signal to
// take them down again in reverse.

const log = logger.child({ component: 'server' });
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  if (config.isProd && config.jwt.usingDevSecret) {
    log.warn('JWT_SECRET is not set: sessions are signed with the public development secret');
  }
  if (!mailEnabled) log.info('no SMTP credentials: password reset codes are logged instead of emailed');

  const db = await connectMongo();
  await prepareDatabase();

  const app = createApp();
  const server = http.createServer(app);
  const io = await createSocketServer(server, db);
  const live = createLiveServices(io, db);
  registerSocketHandlers(io, live);
  const closeWeb = await mountRoutes(app, server, live);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, resolve);
  });
  log.info(
    { port: config.port, url: `http://localhost:${config.port}`, web: config.webDev ? 'live reload' : 'built files' },
    'listening',
  );

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutting down');
    setTimeout(() => {
      log.error('shutdown timed out; exiting');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    try {
      live.stop();
      await closeWeb();
      await io.close(); // also closes the HTTP server
      await closeMongo();
      log.info('stopped');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => log.error({ err: reason }, 'unhandled promise rejection'));
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'uncaught exception');
  process.exit(1);
});

main().catch((err: unknown) => {
  log.fatal({ err }, 'startup failed');
  process.exit(1);
});
