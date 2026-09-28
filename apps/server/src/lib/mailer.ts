import nodemailer from 'nodemailer';
import { config } from '../config/index.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'mailer' });

const transport =
  config.smtp.user && config.smtp.pass
    ? nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: { user: config.smtp.user, pass: config.smtp.pass },
      })
    : null;

export const mailEnabled = transport !== null;

// Sends in the background. Without SMTP credentials nothing can be sent, so
// `whenDisabled` runs instead (local development logs the content).
export function sendMail(to: string, subject: string, text: string, whenDisabled: () => void): void {
  if (!transport) {
    whenDisabled();
    return;
  }
  transport
    .sendMail({ from: `"Four Chess" <${config.smtp.user}>`, to, subject, text })
    .then(() => log.info({ to, subject }, 'mail sent'))
    .catch((err: unknown) => log.error({ to, subject, err }, 'mail failed'));
}
