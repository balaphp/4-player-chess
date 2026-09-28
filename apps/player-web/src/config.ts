// The web app is always served by the server it talks to (built files in
// production, live reload in development), so it uses its own origin whatever
// PORT that server runs on. Set these only to point at a different server.
export const API_URL = import.meta.env.VITE_API_URL ?? '';
export const GAME_URL = import.meta.env.VITE_GAME_URL ?? window.location.origin;

// Seat colors are Okabe-Ito hues, which stay distinguishable under the common
// forms of color vision deficiency.
export const COLOR_HEX: Record<string, string> = {
  red: '#d55e00',
  blue: '#56b4e9',
  yellow: '#f0e442',
  green: '#009e73',
};
