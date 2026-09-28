import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { sendMail } from '../lib/mailer.js';
import { type UserDoc, UserModel } from '../models/user.model.js';

export interface AuthUser {
  id: string; // MongoDB ObjectId hex string
  username: string;
  role: 'user' | 'admin';
}

const RESET_LINK_TTL_MS = 30 * 60 * 1000;
const RESET_CODE_TTL_MS = 10 * 60 * 1000;
const RESET_CODE_MAX_TRIES = 5;
const MIN_PASSWORD_LENGTH = 6;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const hashPassword = (password: string) => bcrypt.hashSync(password, 10);

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, config.jwt.secret) as jwt.JwtPayload;
    if (!UserModel.isValidId(String(payload.sub))) return null; // pre-MongoDB token
    return {
      id: String(payload.sub),
      username: String(payload.username),
      role: payload.role === 'admin' ? 'admin' : 'user',
    };
  } catch {
    return null;
  }
}

// Who a token belongs to right now. The token only proves identity: whether
// the account still exists, is active, and is an admin is read from the
// database, so removing or demoting an account takes effect immediately.
export async function authenticate(token: string): Promise<AuthUser | null> {
  const claimed = token ? verifyToken(token) : null;
  if (!claimed) return null;
  const user = await UserModel.findById(claimed.id);
  if (!user || !user.active) return null;
  return { id: claimed.id, username: user.username, role: user.role };
}

const session = (user: UserDoc) => ({
  token: signToken({ id: user._id.toHexString(), username: user.username, role: user.role }),
  user,
});

function requirePassword(password: unknown, message: string): asserts password is string {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) throw badRequest(message);
}

export const AuthService = {
  async signup(input: { email?: unknown; username?: unknown; password?: unknown }) {
    const { email, username, password } = input;
    if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) throw badRequest('Valid email required');
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      throw badRequest('Username must be 3-20 chars (letters, digits, _)');
    }
    requirePassword(password, 'Password must be at least 6 characters');
    try {
      const user = await UserModel.create({
        email: email.toLowerCase(),
        username,
        passwordHash: hashPassword(password),
        role: 'user',
      });
      return session(user);
    } catch (e) {
      if ((e as { code?: number })?.code === 11000) throw conflict('Email or username already taken');
      throw e;
    }
  },

  async login(input: { identifier?: unknown; password?: unknown }) {
    const { identifier, password } = input;
    if (typeof identifier !== 'string' || typeof password !== 'string') {
      throw badRequest('identifier and password required');
    }
    const user = await UserModel.findByIdentifier(identifier);
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) throw unauthorized('Invalid credentials');
    if (!user.active) throw forbidden('Account is deactivated');
    return session(user);
  },

  async currentUser(userId: string): Promise<UserDoc> {
    const user = await UserModel.findById(userId);
    if (!user) throw notFound('User not found');
    return user;
  },

  // Emails a one-time code. Says nothing about whether the account exists:
  // the caller has already answered the request by the time this runs.
  async requestPasswordReset(identifier: string, log: Logger): Promise<void> {
    if (!identifier) return;
    const user = await UserModel.findByIdentifier(identifier);
    if (!user || !user.active) return;
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await UserModel.setResetCode(user._id, sha256(code), new Date(Date.now() + RESET_CODE_TTL_MS));
    sendMail(
      user.email,
      'Your Four Chess password reset code',
      `Hi ${user.username},\n\nSomeone (hopefully you) asked to reset your Four Chess password.\nYour one-time code is:\n\n    ${code}\n\nIt expires in 10 minutes. If this wasn't you, ignore this email.`,
      () => log.warn({ username: user.username, email: user.email, code }, 'no SMTP configured: password reset code'),
    );
  },

  // Two ways in: an emailed one-time code, or a token link from an admin.
  async resetPassword(input: { token?: unknown; identifier?: unknown; code?: unknown; password?: unknown }) {
    const { token, identifier, code, password } = input;
    requirePassword(password, 'Password must be at least 6 characters');

    let user: UserDoc | null = null;
    if (typeof code === 'string' && typeof identifier === 'string') {
      const candidate = await UserModel.findByIdentifier(identifier.trim());
      if (
        !candidate ||
        !candidate.resetCodeHash ||
        !candidate.resetCodeExpires ||
        candidate.resetCodeExpires <= new Date() ||
        (candidate.resetCodeTries ?? 0) >= RESET_CODE_MAX_TRIES
      ) {
        throw badRequest('Code is invalid or has expired — request a new one');
      }
      if (candidate.resetCodeHash !== sha256(code.trim())) {
        await UserModel.countFailedResetTry(candidate._id);
        throw badRequest('Wrong code');
      }
      user = candidate;
    } else if (typeof token === 'string') {
      user = await UserModel.findByResetToken(sha256(token));
      if (!user) throw badRequest('Reset link is invalid or has expired');
    } else {
      throw badRequest('Missing reset code');
    }

    await UserModel.setPasswordAndClearResets(user._id, hashPassword(password));
    return { username: user.username };
  },

  async changePassword(userId: string, input: { oldPassword?: unknown; newPassword?: unknown }): Promise<void> {
    const { oldPassword, newPassword } = input;
    requirePassword(newPassword, 'New password must be at least 6 characters');
    const user = await UserModel.findById(userId);
    if (!user || !bcrypt.compareSync(String(oldPassword ?? ''), user.passwordHash)) {
      throw badRequest('Current password is incorrect');
    }
    await UserModel.setPassword(user._id, hashPassword(newPassword));
  },

  // An admin hands the link to the player over any channel — the practical
  // recovery path while there is no email provider.
  async createResetLink(userId: string, origin: string) {
    if (!UserModel.isValidId(userId)) throw badRequest('Invalid user id');
    const user = await UserModel.findById(userId);
    if (!user) throw notFound('User not found');
    const token = crypto.randomBytes(32).toString('hex');
    await UserModel.setResetToken(user._id, sha256(token), new Date(Date.now() + RESET_LINK_TTL_MS));
    return { url: `${origin}/reset?token=${token}`, expiresInMinutes: RESET_LINK_TTL_MS / 60000 };
  },
};
