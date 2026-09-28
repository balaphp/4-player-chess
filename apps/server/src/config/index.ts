import './env.js'; // must stay first: loads env/.env.local before process.env is read
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The only module that reads process.env. Everything else imports `config`.

const csv = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// Connection precedence: MONGOHOST + MONGOPORT + MONGOUSER + MONGOPASSWORD
// (the parts most hosting providers inject), then a full MONGODB_URI, then a
// local unauthenticated MongoDB.
export function mongoUriFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.MONGOHOST;
  if (host) {
    const port = env.MONGOPORT || '27017';
    const user = env.MONGOUSER;
    const pass = env.MONGOPASSWORD;
    const auth = user ? `${encodeURIComponent(user)}${pass ? ':' + encodeURIComponent(pass) : ''}@` : '';
    // a single host is addressed directly rather than via replica-set discovery
    return `mongodb://${auth}${host}:${port}/?directConnection=true${user ? '&authSource=admin' : ''}`;
  }
  return env.MONGODB_URI || 'mongodb://localhost:27017/?directConnection=true';
}

// How many proxies sit in front of the server; decides whose address is
// reported as the client IP. Hosting platforms put one in front.
function trustProxy(value: string | undefined, isProd: boolean): boolean | number {
  if (value === undefined || value === '') return isProd ? 1 : false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  const hops = Number(value);
  return Number.isInteger(hops) && hops >= 0 ? hops : false;
}

const DEV_JWT_SECRET = 'dev-secret-four-chess';

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smtpPort = env.SMTP_PORT ?? '465';
const stunUrls = csv(env.STUN_URLS);

export const config = {
  isProd,
  port: Number(env.PORT ?? 4000),
  // development: compile the web app on the fly on this same port (set by the dev script)
  webDev: env.WEB_DEV === '1',
  trustProxy: trustProxy(env.TRUST_PROXY, isProd),
  log: {
    level: env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
    // readable lines for a terminal; JSON lines for a log collector
    pretty: env.LOG_PRETTY !== undefined ? env.LOG_PRETTY === '1' : !isProd,
  },
  mongo: {
    uri: mongoUriFromEnv(env),
    dbName: env.FOUR_CHESS_DB_NAME ?? 'four-chess',
  },
  // accounts with these emails are made admins when the server starts
  adminEmails: csv(env.ADMIN_EMAILS).map((email) => email.toLowerCase()),
  jwt: {
    secret: env.JWT_SECRET ?? DEV_JWT_SECRET,
    usingDevSecret: !env.JWT_SECRET || env.JWT_SECRET === DEV_JWT_SECRET,
    expiresIn: '7d',
  },
  smtp: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS || env.GMAIL_APP_PASSWORD,
    host: env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(smtpPort),
    secure: smtpPort === '465',
  },
  rtc: {
    stunUrls: stunUrls.length > 0 ? stunUrls : ['stun:stun.l.google.com:19302'],
    turnUrls: csv(env.TURN_URLS),
    turnUsername: env.TURN_USERNAME ?? '',
    turnPassword: env.TURN_PASSWORD ?? '',
  },
  paths: {
    // where the built web app may live, most specific first
    publicCandidates: [
      env.PUBLIC_DIR, // explicit override
      path.resolve(srcDir, '..', 'public'), // docker image layout
      path.resolve(srcDir, '..', '..', 'player-web', 'dist'), // local `bun run build`
    ].filter((p): p is string => !!p),
    webRoot: path.resolve(srcDir, '..', '..', 'player-web'),
  },
} as const;

export type Config = typeof config;
