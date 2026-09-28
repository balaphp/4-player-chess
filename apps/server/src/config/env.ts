import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// env/.env.local holds this machine's own settings and secrets (database
// login, SMTP credentials, ...). It is gitignored and overrides the values
// from env/.env.dev. It must load before process.env is read, which is why
// config/index.ts imports this module first.
export function loadLocalEnv(
  file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'env', '.env.local'),
): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

loadLocalEnv();
