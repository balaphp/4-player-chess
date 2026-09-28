import pino, { type Logger, type LoggerOptions } from 'pino';
import pretty from 'pino-pretty';
import { config } from '../config/index.js';

// One root logger; everything else logs through a child that carries its own
// context (request id + ip, userId, gameId, ...), so a single line is enough
// to tell who did what, where.
const options: LoggerOptions = {
  level: config.log.level,
  base: { service: 'four-chess-server' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['password', 'token', 'passwordHash', '*.password', '*.token', '*.passwordHash', 'headers.authorization'],
    censor: '[redacted]',
  },
};

export const logger: Logger = config.log.pretty
  ? pino(
      options,
      // a plain stream rather than a worker transport, so lines are never lost on exit
      pretty({
        colorize: true,
        singleLine: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname,service',
        sync: true,
      }),
    )
  : pino(options);

export type { Logger };
