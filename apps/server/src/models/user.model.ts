import type { Filter } from 'mongodb';
import { db, ObjectId } from '../db/mongo.js';

export interface UserDoc {
  _id: ObjectId;
  email: string;
  username: string;
  passwordHash: string;
  resetTokenHash?: string; // sha256 of an outstanding password-reset token (admin link)
  resetExpires?: Date;
  resetCodeHash?: string; // sha256 of an outstanding emailed one-time code
  resetCodeExpires?: Date;
  resetCodeTries?: number;
  role: 'user' | 'admin';
  active: boolean;
  createdAt: Date;
}

const users = () => db().collection<UserDoc>('users');

// people sign in with either their email or their username
const byIdentifier = (identifier: string): Filter<UserDoc> => ({
  $or: [{ email: identifier.toLowerCase() }, { username: identifier }],
});

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const UserModel = {
  async ensureIndexes(): Promise<void> {
    await users().createIndex({ email: 1 }, { unique: true });
    await users().createIndex({ username: 1 }, { unique: true });
  },

  isValidId: (id: string): boolean => ObjectId.isValid(id),

  findById: (id: string) => users().findOne({ _id: new ObjectId(id) }),

  findByIdentifier: (identifier: string) => users().findOne(byIdentifier(identifier)),

  findByEmail: (email: string) => users().findOne({ email: email.toLowerCase() }),

  // true when the account exists and was not an admin already
  async promoteByEmail(email: string): Promise<boolean> {
    const res = await users().updateOne({ email: email.toLowerCase(), role: { $ne: 'admin' } }, { $set: { role: 'admin' } });
    return res.modifiedCount > 0;
  },

  remove: (id: ObjectId) => users().deleteOne({ _id: id }),

  findByResetToken: (tokenHash: string) =>
    users().findOne({ resetTokenHash: tokenHash, resetExpires: { $gt: new Date() } }),

  // throws the driver's duplicate-key error (code 11000) when email or username is taken
  async create(fields: Pick<UserDoc, 'email' | 'username' | 'passwordHash' | 'role'>): Promise<UserDoc> {
    const user: UserDoc = { _id: new ObjectId(), ...fields, active: true, createdAt: new Date() };
    await users().insertOne(user);
    return user;
  },

  setResetToken: (id: ObjectId, tokenHash: string, expires: Date) =>
    users().updateOne({ _id: id }, { $set: { resetTokenHash: tokenHash, resetExpires: expires } }),

  setResetCode: (id: ObjectId, codeHash: string, expires: Date) =>
    users().updateOne(
      { _id: id },
      { $set: { resetCodeHash: codeHash, resetCodeExpires: expires, resetCodeTries: 0 } },
    ),

  countFailedResetTry: (id: ObjectId) => users().updateOne({ _id: id }, { $inc: { resetCodeTries: 1 } }),

  setPassword: (id: ObjectId, passwordHash: string) => users().updateOne({ _id: id }, { $set: { passwordHash } }),

  // a successful reset also invalidates every outstanding code and link
  setPasswordAndClearResets: (id: ObjectId, passwordHash: string) =>
    users().updateOne(
      { _id: id },
      {
        $set: { passwordHash },
        $unset: { resetTokenHash: '', resetExpires: '', resetCodeHash: '', resetCodeExpires: '', resetCodeTries: '' },
      },
    ),

  update: (id: string, patch: Partial<Pick<UserDoc, 'active' | 'role'>>) =>
    users().findOneAndUpdate({ _id: new ObjectId(id) }, { $set: patch }, { returnDocument: 'after' }),

  list: () => users().find().sort({ createdAt: -1 }).toArray(),

  count: (filter: Filter<UserDoc> = {}) => users().countDocuments(filter),

  searchActiveByUsername: (query: string, limit: number) =>
    users()
      .find({ active: true, username: { $regex: escapeRegex(query), $options: 'i' } })
      .sort({ username: 1 })
      .limit(limit)
      .toArray(),
};
