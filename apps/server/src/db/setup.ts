import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { ChatModel } from '../models/chat.model.js';
import { GameModel } from '../models/game.model.js';
import { UserModel } from '../models/user.model.js';

const log = logger.child({ component: 'db-setup' });

// the account earlier versions created on every new database, with a
// password printed in the README
const RETIRED_ADMIN_EMAIL = 'admin@chess.local';

// Runs once at startup, after the connection is up.
export async function prepareDatabase(): Promise<void> {
  await UserModel.ensureIndexes();
  await GameModel.ensureIndexes();
  await ChatModel.ensureIndexes();
  await syncAdmins();
}

// There is no built-in admin and no password in code or config. Admins are
// named by email in ADMIN_EMAILS and promoted here. Only accounts that already
// exist are promoted: sign-up does not verify email addresses, so granting
// admin at sign-up would hand it to whoever registers a listed address first.
async function syncAdmins(): Promise<void> {
  for (const email of config.adminEmails) {
    if (await UserModel.promoteByEmail(email)) {
      log.info({ email }, 'account promoted to admin; it must sign in again to use it');
    } else if (!(await UserModel.findByEmail(email))) {
      log.warn({ email }, 'ADMIN_EMAILS names an address with no account: register it, then restart the server');
    }
  }

  await retireDefaultAdmin();

  if ((await UserModel.count({ role: 'admin', active: true })) === 0) {
    log.warn('there is no admin account: set ADMIN_EMAILS to the email of a registered account');
  }
}

// Removed as soon as another admin exists to take its place, so a database is
// never left without one.
async function retireDefaultAdmin(): Promise<void> {
  const retired = await UserModel.findByEmail(RETIRED_ADMIN_EMAIL);
  if (!retired) return;
  const others = await UserModel.count({ role: 'admin', active: true, email: { $ne: RETIRED_ADMIN_EMAIL } });
  if (others === 0) {
    log.warn(
      { email: RETIRED_ADMIN_EMAIL },
      'the default admin account still exists: add your own email to ADMIN_EMAILS to replace it',
    );
    return;
  }
  await UserModel.remove(retired._id);
  log.warn({ email: RETIRED_ADMIN_EMAIL }, 'removed the default admin account');
}
