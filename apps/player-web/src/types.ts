import type { Color, GameJSON, Mode, Move, PowerId, Shield, Trap, Wall } from '@four-chess/engine';

export type SeatInfo =
  | { kind: 'human'; userId: string; username: string; connected: boolean; autopilot?: boolean }
  | { kind: 'ai'; difficulty: 'easy' | 'medium' }
  | null;

export interface LobbyView {
  id: string;
  name: string;
  hostUserId: string;
  mode: Mode;
  powers: boolean;
  open: boolean;
  status: 'waiting' | 'playing';
  gameId: string | null;
  seats: Record<Color, SeatInfo>;
  humanCount: number;
  filledCount: number;
}

export interface ChatMessage {
  id: string;
  gameId: string;
  userId: string;
  username: string;
  color: Color;
  text: string;
  at: number;
}

// what everyone in the game is sent: powers are secret, so its state holds
// no wall, no trap and nobody's unused powers
export interface GameView {
  id: string;
  lobbyId: string;
  groupName: string;
  mode: Mode;
  seats: Record<Color, SeatInfo>;
  startedAt: number;
  state: GameJSON;
}

// what only this player is sent on top of that
export interface PrivateView {
  gameId: string;
  ply: number; // the position this belongs to
  powers: PowerId[]; // their own, still unused
  walls: Wall[];
  shields: Shield[];
  traps: Trap[];
  extraMoves: Move[]; // legal moves a wall they cannot see makes possible
}
