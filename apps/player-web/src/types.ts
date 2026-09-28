import type { Color, GameJSON, Mode } from '@four-chess/engine';

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

export interface GameView {
  id: string;
  lobbyId: string;
  groupName: string;
  mode: Mode;
  seats: Record<Color, SeatInfo>;
  startedAt: number;
  state: GameJSON;
}
