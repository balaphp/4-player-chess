import { config } from '../config/index.js';

interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

// Audio and video flow peer-to-peer; the server only relays signalling and
// hands out the ICE servers that help peers find each other. STUN is enough
// on most home networks; a TURN relay is needed behind strict NATs/firewalls.
export const RtcService = {
  iceServers(): IceServer[] {
    const servers: IceServer[] = [{ urls: [...config.rtc.stunUrls] }];
    if (config.rtc.turnUrls.length > 0) {
      servers.push({
        urls: [...config.rtc.turnUrls],
        username: config.rtc.turnUsername,
        credential: config.rtc.turnPassword,
      });
    }
    return servers;
  },
};
