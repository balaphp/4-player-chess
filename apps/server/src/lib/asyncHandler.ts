import type { Request, RequestHandler, Response } from 'express';

// express 4 doesn't route async rejections to the error handler on its own
export const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };
