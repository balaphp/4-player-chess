import { seatColors, type Trap } from '@four-chess/engine';
import { type LiveGameDoc, type LobbyDoc, seatColorOf } from '../models/lobby.model.js';

export const lobbyView = (l: LobbyDoc) => ({
  id: l._id,
  name: l.name,
  hostUserId: l.hostUserId,
  mode: l.mode,
  powers: l.powers,
  open: l.open,
  status: l.status,
  gameId: l.gameId,
  seats: l.seats,
  seatColors: seatColors(l.mode),
  humanCount: seatColors(l.mode).filter((c) => l.seats[c]?.kind === 'human').length,
  filledCount: seatColors(l.mode).filter((c) => l.seats[c]).length,
});

// the game as everyone may see it
export const liveGameView = (g: LiveGameDoc) => ({
  id: g._id,
  lobbyId: g.lobbyId,
  groupName: g.groupName,
  mode: g.mode,
  seats: g.seats,
  startedAt: g.startedAt.getTime(),
  // secret traps never ride the shared payload
  state: { ...g.state, traps: [] },
});

// a player's own secret traps, sent to that player only
export function privateTrapsFor(g: LiveGameDoc, userId: string): Trap[] {
  const color = seatColorOf(g.seats, userId);
  if (!color) return [];
  return (g.state.traps ?? []).filter((t) => t.color === color);
}

// one row in the "games in progress" list
export const liveGameSummaryView = (g: LiveGameDoc) => ({
  id: g._id,
  groupName: g.groupName,
  mode: g.mode,
  open: g.open,
  powers: !!g.state.powersEnabled,
  ply: g.state.ply,
  players: seatColors(g.mode).map((c) => {
    const s = g.seats[c];
    return { color: c, name: s?.kind === 'human' ? s.username : `AI (${s?.kind === 'ai' ? s.difficulty : '?'})` };
  }),
  startedAt: g.startedAt.getTime(),
});

// admin dashboard: raw-ish view of a game in flight
export const liveGameAdminView = (g: LiveGameDoc) => ({
  id: g._id,
  groupName: g.groupName,
  mode: g.mode,
  turn: g.state.turn,
  ply: g.state.ply,
  alive: g.state.alive,
  seats: g.seats,
  startedAt: g.startedAt.getTime(),
});
