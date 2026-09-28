import type { AIDifficulty, Mode } from '@four-chess/engine';
import type { Collection } from 'mongodb';
import { GameError } from '../../lib/errors.js';
import type { LobbyDoc, SeatInfo } from '../../models/lobby.model.js';

export const normalizeMode = (mode: Mode): Mode => (mode === 'teams' || mode === 'duel' ? mode : 'ffa');

// who plays a seat when no human does: an AI seat, or a human on autopilot
export function aiControl(seat: SeatInfo): { difficulty: AIDifficulty } | null {
  if (!seat) return null;
  if (seat.kind === 'ai') return { difficulty: seat.difficulty };
  if (seat.autopilot) return { difficulty: 'medium' };
  return null;
}

export async function requireHost(lobbies: Collection<LobbyDoc>, userId: string, lobbyId: string): Promise<LobbyDoc> {
  const lobby = await lobbies.findOne({ _id: lobbyId });
  if (!lobby) throw new GameError('Group not found');
  if (lobby.hostUserId !== userId) throw new GameError('Only the host can do that');
  return lobby;
}
