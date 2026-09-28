import type { Request, Response } from 'express';
import { RtcService } from '../services/rtc.service.js';

const SERVICE = 'four-chess server (api + realtime games)';

export const SystemController = {
  health(_req: Request, res: Response) {
    res.json({ service: SERVICE, ok: true });
  },

  async rtcConfig(_req: Request, res: Response) {
    res.json({ iceServers: RtcService.iceServers() });
  },
};
