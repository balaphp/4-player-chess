import type { UserDoc } from '../models/user.model.js';

// what a client may see of an account: never the password hash or reset data
export const userView = (u: UserDoc) => ({
  id: u._id.toHexString(),
  email: u.email,
  username: u.username,
  role: u.role,
  active: u.active,
  createdAt: u.createdAt,
});
