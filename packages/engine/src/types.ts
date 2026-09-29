export type Color = 'red' | 'blue' | 'yellow' | 'green';
export type PieceType = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';
export type Mode = 'ffa' | 'teams' | 'duel';

// duel is classic 1v1: red vs yellow
export function seatColors(mode: Mode): Color[] {
  return mode === 'duel' ? ['red', 'yellow'] : ['red', 'blue', 'yellow', 'green'];
}

export const MODE_LABEL: Record<Mode, string> = {
  duel: '1 vs 1',
  ffa: '4 vs 4',
  teams: 'Tag team 2 vs 2',
};
export type EliminationReason = 'checkmate' | 'stalemate' | 'king-captured' | 'resigned' | 'timeout';

export interface Pos {
  x: number;
  y: number;
}

export interface Piece {
  type: PieceType;
  color: Color;
  hasMoved: boolean;
  dead: boolean; // eliminated player's piece: immobile obstacle, still capturable
  frozenUntil?: number; // Fainted power: no moves, no captures, no check
}

// ---------- powers ----------

export type PowerId =
  | 'faint'
  | 'shield'
  | 'mine'
  | 'wall'
  | 'teleport';

export const ALL_POWERS: PowerId[] = [
  'faint',
  'shield',
  'mine',
  'wall',
  'teleport',
];

// Every lasting effect (freeze, shield, wall, unexploded traps) wears off
// once the owner's opponents have made 6 moves.
export const EFFECT_OPPONENT_MOVES = 6;

export const POWER_INFO: Record<PowerId, { icon: string; name: string; hint: string }> = {
  faint: { icon: '😴', name: 'Fainted', hint: 'Secretly trap a square: the next ENEMY piece landing there falls asleep (immobile and uncapturable for 1 turn). Untriggered traps fade after 6 opponent moves.' },
  shield: { icon: '🛡', name: 'Shield', hint: 'Protect a square in your home rows: any of your pieces on that square cannot be captured for 6 opponent moves. Opponents see the shield, but not how long it lasts.' },
  mine: { icon: '💣', name: 'Land Mine', hint: 'Secretly mine a square: the next ENEMY piece landing there is destroyed (no points for anyone). Fades after 6 opponent moves.' },
  wall: { icon: '🧱', name: 'Fortress', hint: 'Secretly make an empty square impassable for 6 opponent moves. An opponent only finds it when a move runs into it.' },
  teleport: { icon: '🌀', name: 'Teleport', hint: 'Place a hidden trap on an empty square. The next ENEMY piece that steps on it is teleported to a random empty square anywhere on the board.' },
};

export interface Trap {
  type: 'faint' | 'mine' | 'teleport';
  color: Color;
  x: number;
  y: number;
  expires?: number; // ply after which an untriggered trap fades
}

export interface Wall {
  x: number;
  y: number;
  until: number;
  color?: Color; // who placed it; absent on walls from before this was recorded
  knownTo?: Color[]; // enemies whose move has run into it
}

export interface Shield {
  x: number;
  y: number;
  until: number;
  color: Color;
}

// How many more moves the owner's opponents will make before an effect that
// ends at ply `until` disappears: the same unit the power descriptions use.
export function opponentMovesLeft(
  state: { mode: Mode; alive: Color[]; turn: Color; ply: number },
  until: number,
  owner?: Color,
): number {
  const plies = until - state.ply;
  if (plies <= 0) return 0;
  const order = seatColors(state.mode).filter((c) => state.alive.includes(c));
  if (order.length === 0) return 0;
  const start = Math.max(0, order.indexOf(state.turn));
  let moves = 0;
  for (let k = 0; k < plies; k++) {
    if (order[(start + k) % order.length] !== owner) moves++;
  }
  return moves;
}

export type PowerAction = { power: 'faint' | 'mine' | 'wall' | 'shield' | 'teleport'; target: Pos };

export type Cell = Piece | null;

export interface Move {
  from: Pos;
  to: Pos;
  promotion?: PieceType;
  castle?: 'king' | 'queen';
}

export interface AppliedMove extends Move {
  color: Color;
  piece: PieceType;
  captured: { type: PieceType; color: Color } | null;
  notation: string;
  power?: PowerId; // set when this entry is a power use, not a move
  sprung?: Trap['type'][]; // traps this move set off on its landing square
}

export interface Elimination {
  color: Color;
  reason: EliminationReason;
}

export interface PieceJSON {
  x: number;
  y: number;
  type: PieceType;
  color: Color;
  dead: boolean;
  hasMoved: boolean;
  frozenUntil?: number;
}

export interface GameJSON {
  mode: Mode;
  pieces: PieceJSON[];
  points: Record<Color, number>;
  powersEnabled?: boolean;
  powers?: Record<Color, PowerId[]>; // still unused per color
  // the full lists exist server-side only: clients get what viewOf leaves
  walls?: Wall[];
  shields?: Shield[];
  traps?: Trap[];
  turn: Color;
  alive: Color[];
  eliminated: Elimination[];
  inCheck: Color[];
  winners: Color[] | null;
  history: AppliedMove[];
  lastMove: AppliedMove | null;
  ply: number;
  rev?: number; // bumps on every applied action, including powers that leave ply unchanged
}

export const SIZE = 14;

// turn order: red (bottom) -> blue (left) -> yellow (top) -> green (right)
export const COLORS: Color[] = ['red', 'blue', 'yellow', 'green'];

// tag-team partners sit opposite each other
export const TEAM_OF: Record<Color, 0 | 1> = { red: 0, yellow: 0, blue: 1, green: 1 };

// A player has one power in play at a time: a wall or shield still standing,
// or a trap still armed. The next can be set once that one has ended or gone
// off. Returns the power in play, or null.
export function powerInPlay(
  state: { ply: number; walls?: Wall[]; shields?: Shield[]; traps?: Trap[] },
  color: Color,
): PowerId | null {
  if ((state.walls ?? []).some((w) => w.color === color && w.until > state.ply)) return 'wall';
  if ((state.shields ?? []).some((s) => s.color === color && s.until > state.ply)) return 'shield';
  const armed = (state.traps ?? []).find(
    (t) => t.color === color && (t.expires ?? Number.MAX_SAFE_INTEGER) > state.ply,
  );
  return armed ? armed.type : null;
}

// ---------- who sees which power ----------

// a player and, in a team game, their partner share what they know
export function sharesPowers(mode: Mode, viewer: Color | null, owner: Color | undefined): boolean {
  if (!viewer || !owner) return false;
  return mode === 'teams' ? TEAM_OF[viewer] === TEAM_OF[owner] : viewer === owner;
}

// Traps and walls are secret: seen by their owner's side, and a wall also by
// an enemy whose move has run into it. Spectators (viewer null) see neither.
export function canSeePower(
  mode: Mode,
  viewer: Color | null,
  power: { color?: Color; knownTo?: Color[] },
): boolean {
  if (!power.color) return true; // a wall from before owners were recorded
  return sharesPowers(mode, viewer, power.color) || (viewer !== null && !!power.knownTo?.includes(viewer));
}

// The game as `viewer` may see it (null: a spectator). Enemy traps and walls
// are left out, and so is every record of a power being used. Shields show
// to everyone, but only their owner's side learns how long they last: for
// the others `until` says no more than "still standing".
export function viewOf(state: GameJSON, viewer: Color | null): GameJSON {
  const mine = (owner?: Color) => sharesPowers(state.mode, viewer, owner);
  const until = (p: { until: number; color?: Color }) => (mine(p.color) || !p.color ? p.until : state.ply + 1);
  const view: GameJSON = {
    ...state,
    walls: (state.walls ?? [])
      .filter((w) => w.until > state.ply && canSeePower(state.mode, viewer, w))
      .map((w) => ({ x: w.x, y: w.y, until: until(w), ...(w.color ? { color: w.color } : {}) })),
    shields: (state.shields ?? [])
      .filter((s) => s.until > state.ply)
      .map((s) => ({ x: s.x, y: s.y, until: until(s), color: s.color })),
    traps: (state.traps ?? []).filter((t) => canSeePower(state.mode, viewer, t)).map((t) => ({ ...t })),
    history: state.history.filter((h) => !h.power),
  };
  if (state.powers) {
    const left = state.powers;
    view.powers = {
      red: mine('red') ? [...left.red] : [],
      blue: mine('blue') ? [...left.blue] : [],
      yellow: mine('yellow') ? [...left.yellow] : [],
      green: mine('green') ? [...left.green] : [],
    };
  }
  delete view.rev; // it moves when a power is used
  return view;
}

// direction each color's pawns advance
export const FORWARD: Record<Color, Pos> = {
  red: { x: 0, y: 1 },
  blue: { x: 1, y: 0 },
  yellow: { x: 0, y: -1 },
  green: { x: -1, y: 0 },
};

export const PIECE_VALUE: Record<PieceType, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 1000 };

export const FILES = 'abcdefghijklmn';

export function posName(p: Pos): string {
  return `${FILES[p.x]}${p.y + 1}`;
}

// Duel games play on the central 8x8 window of the big board; their squares
// are named a1-h8 like classic chess instead of the raw 14x14 coordinates.
export const DUEL_OFFSET = 3;

export function posNameFor(mode: Mode, p: Pos): string {
  const off = mode === 'duel' ? DUEL_OFFSET : 0;
  return `${FILES[p.x - off]}${p.y + 1 - off}`;
}
