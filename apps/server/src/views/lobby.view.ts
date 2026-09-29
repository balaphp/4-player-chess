import {
  type Color,
  FourChess,
  type Move,
  type PowerId,
  seatColors,
  type Shield,
  type Trap,
  viewOf,
  type Wall,
} from '@four-chess/engine';
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

// The game as everyone may see it. Powers are secret, so the shared payload
// carries no wall, no trap and no record of a power being used: only shields,
// without their end.
export const liveGameView = (g: LiveGameDoc) => ({
  id: g._id,
  lobbyId: g.lobbyId,
  groupName: g.groupName,
  mode: g.mode,
  seats: g.seats,
  startedAt: g.startedAt.getTime(),
  state: viewOf(g.state, null),
});

// what one player may see on top of that, sent to that player only
export interface PrivateGameView {
  gameId: string;
  ply: number; // the position this belongs to
  powers: PowerId[]; // their own, still unused
  walls: Wall[];
  shields: Shield[];
  traps: Trap[];
  // legal moves their own board cannot work out: see FourChess.unseenLegalMoves
  extraMoves: Move[];
}

export function privateGameView(g: LiveGameDoc, color: Color): PrivateGameView {
  const seen = viewOf(g.state, color);
  return {
    gameId: g._id,
    ply: g.state.ply,
    powers: seen.powers?.[color] ?? [],
    walls: seen.walls ?? [],
    shields: seen.shields ?? [],
    traps: seen.traps ?? [],
    extraMoves: g.state.powersEnabled ? FourChess.fromJSON(g.state).unseenLegalMoves(color) : [],
  };
}

// null for anyone who is not playing
export function privateGameViewFor(g: LiveGameDoc, userId: string): PrivateGameView | null {
  const color = seatColorOf(g.seats, userId);
  return color ? privateGameView(g, color) : null;
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
