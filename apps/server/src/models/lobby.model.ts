import type { AIDifficulty, Color, GameJSON, Mode } from '@four-chess/engine';

// Live (in-play) state, shared by every server instance: the groups people
// gather in and the games being played. Both are read and written by the
// game manager, whose compare-and-swap updates keep instances from
// overwriting each other.

export type SeatInfo =
  | { kind: 'human'; userId: string; username: string; connected: boolean; autopilot?: boolean }
  | { kind: 'ai'; difficulty: AIDifficulty }
  | null;

export interface LobbyDoc {
  _id: string;
  name: string;
  hostUserId: string;
  mode: Mode;
  powers: boolean;
  open: boolean;
  status: 'waiting' | 'playing';
  seats: Record<Color, SeatInfo>;
  gameId: string | null;
  memberIds: string[]; // human userIds, for cheap lookups
  createdAt: Date;
}

export interface LiveGameDoc {
  _id: string;
  lobbyId: string;
  groupName: string;
  mode: Mode;
  open: boolean;
  seats: Record<Color, SeatInfo>;
  playerIds: string[];
  state: GameJSON; // full engine state, secret traps included
  startedAt: Date;
  updatedAt: Date;
}

export const LOBBIES_COLLECTION = 'liveLobbies';
export const LIVE_GAMES_COLLECTION = 'liveGames';

export const emptySeats = (): Record<Color, SeatInfo> => ({ red: null, blue: null, yellow: null, green: null });

export function seatColorOf(seats: Record<Color, SeatInfo>, userId: string): Color | undefined {
  return (Object.keys(seats) as Color[]).find((c) => {
    const seat = seats[c];
    return seat?.kind === 'human' && seat.userId === userId;
  });
}
