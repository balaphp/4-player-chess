import type { Request, Response } from 'express';
import { AuthService } from '../services/auth.service.js';
import { userView } from '../views/user.view.js';

export const AuthController = {
  async signup(req: Request, res: Response) {
    const { token, user } = await AuthService.signup(req.body ?? {});
    req.log.info({ userId: user._id.toHexString(), username: user.username }, 'account created');
    res.json({ token, user: userView(user) });
  },

  async login(req: Request, res: Response) {
    const { token, user } = await AuthService.login(req.body ?? {});
    req.log.info({ userId: user._id.toHexString() }, 'signed in');
    res.json({ token, user: userView(user) });
  },

  async me(req: Request, res: Response) {
    res.json({ user: userView(await AuthService.currentUser(req.user!.id)) });
  },

  async forgot(req: Request, res: Response) {
    const identifier = String(req.body?.identifier ?? '').trim();
    // always the same answer, sent first: never reveal whether an account exists
    res.json({ ok: true });
    try {
      await AuthService.requestPasswordReset(identifier, req.log);
    } catch (err) {
      req.log.error({ err }, 'password reset request failed');
    }
  },

  async reset(req: Request, res: Response) {
    const { username } = await AuthService.resetPassword(req.body ?? {});
    req.log.info({ username }, 'password reset');
    res.json({ ok: true, username });
  },

  async changePassword(req: Request, res: Response) {
    await AuthService.changePassword(req.user!.id, req.body ?? {});
    req.log.info('password changed');
    res.json({ ok: true });
  },
};
