import fs from 'node:fs';
import type http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import express, { type Express } from 'express';
import { config } from '../config/index.js';
import { SystemController } from '../controllers/system.controller.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'web' });

// One port for everything in development too: Vite runs inside this server
// and shares its HTTP listener, so the app, the API, the sockets and live
// reload all live on PORT.
async function mountLiveReload(app: Express, server: http.Server): Promise<() => Promise<void>> {
  const { webRoot } = config.paths;
  const viteDir = path.dirname(createRequire(path.join(webRoot, 'package.json')).resolve('vite/package.json'));
  const { createServer } = await import(path.join(viteDir, 'dist', 'node', 'index.js'));
  // Imported directly: Vite's own config loader writes a temporary module next
  // to the file, which `bun --watch` would take for a source change.
  const { default: webConfig } = await import(path.join(webRoot, 'vite.config.ts'));
  const vite = await createServer({
    ...webConfig,
    configFile: false,
    root: webRoot,
    mode: 'dev',
    appType: 'spa',
    server: { ...webConfig.server, middlewareMode: true, hmr: { server } },
  });
  app.use(vite.middlewares);
  log.info('serving the web app with live reload');
  return () => vite.close();
}

function mountBuiltFiles(app: Express): void {
  const { publicCandidates } = config.paths;
  const publicDir = path.resolve(publicCandidates.find((p) => fs.existsSync(p)) ?? publicCandidates[0]);
  if (!fs.existsSync(publicDir)) {
    app.get('/', SystemController.health);
    log.warn({ publicDir }, 'no built web app found; serving the API only');
    return;
  }
  app.use(express.static(publicDir));
  // SPA fallback so /admin (and any client route) loads the app
  app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  log.info({ publicDir }, 'serving the built web app');
}

// Serves the web app after the API routes. Returns what to call on shutdown.
export async function mountWebApp(app: Express, server: http.Server): Promise<() => Promise<void>> {
  if (config.webDev) return mountLiveReload(app, server);
  mountBuiltFiles(app);
  return async () => {};
}
