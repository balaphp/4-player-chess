import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { AIDifficulty, Color, Mode } from '@four-chess/engine';
import { MODE_LABEL, seatColors, TEAM_OF } from '@four-chess/engine';
import { User } from '../api';
import { COLOR_HEX } from '../config';
import { LobbyView } from '../types';

// seats sit around the table the way the armies sit around the board
const POSITION: Record<Color, 'top' | 'left' | 'right' | 'bottom'> = {
  yellow: 'top',
  blue: 'left',
  green: 'right',
  red: 'bottom',
};

const MODES: Mode[] = ['ffa', 'teams', 'duel'];

const MODE_DESC: Record<Mode, string> = {
  ffa: 'Four players, everyone for themselves — last king standing wins.',
  teams: 'Red + Yellow vs Blue + Green — defeat both enemy kings to win.',
  duel: 'Classic chess: Red vs Yellow on the 8×8 centre board.',
};

// home rows of each army on the 14x14 board (and inside the duel window)
const HOME: Record<Mode, Partial<Record<Color, { x: number; y: number; w: number; h: number }>>> = {
  ffa: {
    yellow: { x: 3, y: 0, w: 8, h: 2 },
    red: { x: 3, y: 12, w: 8, h: 2 },
    blue: { x: 0, y: 3, w: 2, h: 8 },
    green: { x: 12, y: 3, w: 2, h: 8 },
  },
  teams: {
    yellow: { x: 3, y: 0, w: 8, h: 2 },
    red: { x: 3, y: 12, w: 8, h: 2 },
    blue: { x: 0, y: 3, w: 2, h: 8 },
    green: { x: 12, y: 3, w: 2, h: 8 },
  },
  duel: {
    yellow: { x: 3, y: 3, w: 8, h: 2 },
    red: { x: 3, y: 9, w: 8, h: 2 },
  },
};

export function Room({
  lobby,
  me,
  emit,
  onLeave,
}: {
  lobby: LobbyView;
  me: User;
  emit: (event: string, payload?: Record<string, unknown>) => Promise<any>;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [filling, setFilling] = useState(false);

  const isHost = lobby.hostUserId === me.id;
  const seats = seatColors(lobby.mode);
  const mySeat = seats.find((c) => lobby.seats[c]?.kind === 'human' && (lobby.seats[c] as any).userId === me.id);
  const emptySeats = seats.filter((c) => !lobby.seats[c]);
  const filled = seats.length - emptySeats.length;
  const allFilled = emptySeats.length === 0;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(lobby.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the code is still visible to copy by hand */
    }
  };

  const addAI = (color: Color, difficulty: AIDifficulty) =>
    emit('lobby:setAI', { lobbyId: lobby.id, color, on: true, difficulty });

  const fillWithAI = async () => {
    setFilling(true);
    try {
      for (const color of emptySeats) await addAI(color, 'medium');
    } finally {
      setFilling(false);
    }
  };

  const seatCard = (color: Color) => {
    const seat = lobby.seats[color];
    const mine = mySeat === color;
    return (
      <div
        key={color}
        className={`seat-card ${POSITION[color]} ${seat ? 'filled' : 'empty'} ${mine ? 'mine' : ''}`}
        style={{ '--seat': COLOR_HEX[color] } as CSSProperties}
      >
        <div className="seat-head">
          <span className="color-chip" style={{ background: COLOR_HEX[color] }} />
          <span className="seat-color">{color}</span>
          {lobby.mode === 'teams' && <span className="seat-tag">Team {TEAM_OF[color] + 1}</span>}
          {mine && <span className="seat-tag you">You</span>}
          {seat?.kind === 'human' && seat.userId === lobby.hostUserId && <span className="seat-tag">Host</span>}
        </div>
        {seat?.kind === 'human' && (
          <div className="seat-body">
            <span className="seat-name">{seat.username}</span>
            {!seat.connected && <span className="muted small">offline</span>}
            {mine ? (
              <label className="check" title="The AI makes your moves while you watch">
                <input
                  type="checkbox"
                  checked={!!seat.autopilot}
                  onChange={(e) => emit('lobby:setAutopilot', { lobbyId: lobby.id, on: e.target.checked })}
                />
                🤖 AI plays for me
              </label>
            ) : (
              seat.autopilot && <span className="muted small">🤖 autopilot</span>
            )}
          </div>
        )}
        {seat?.kind === 'ai' && (
          <div className="seat-body">
            <span className="seat-name">🤖 AI · {seat.difficulty}</span>
            {isHost && (
              <button className="btn subtle small" onClick={() => emit('lobby:setAI', { lobbyId: lobby.id, color, on: false })}>
                Remove
              </button>
            )}
          </div>
        )}
        {!seat && (
          <div className="seat-body">
            {mySeat && (
              <button className="btn subtle small" onClick={() => emit('lobby:sit', { lobbyId: lobby.id, color })}>
                Sit here
              </button>
            )}
            {isHost && (
              <>
                <button className="btn subtle small" onClick={() => addAI(color, 'easy')}>
                  + AI easy
                </button>
                <button className="btn subtle small" onClick={() => addAI(color, 'medium')}>
                  + AI medium
                </button>
              </>
            )}
            {!mySeat && !isHost && <span className="muted small">Empty seat</span>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="room">
      <div className="room-head">
        <div>
          <h2>{lobby.name}</h2>
          <div className="room-meta">
            <button className="chip" onClick={copyCode} title="Copy the group code to invite players">
              Code <code>{lobby.id}</code> {copied ? '✓ Copied' : '⧉ Copy'}
            </button>
            <span className="chip">{lobby.open ? 'Open group' : 'Private group'}</span>
            <span className="chip">{lobby.powers ? '⚡ Powers on' : 'Powers off'}</span>
          </div>
        </div>
        <button className="btn subtle" onClick={onLeave}>
          Leave group
        </button>
      </div>

      <div className="mode-box">
        <div className="seg mode-row">
          {MODES.map((m) => (
            <button
              key={m}
              className={lobby.mode === m ? 'seg-btn active' : 'seg-btn'}
              disabled={!isHost}
              onClick={() => emit('lobby:setMode', { lobbyId: lobby.id, mode: m })}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="mode-desc">
          {MODE_DESC[lobby.mode]}
          {!isHost && ' Only the host can change the mode.'}
        </div>
      </div>

      <div className={`table ${lobby.mode === 'duel' ? 'duel' : ''}`}>
        {seats.map(seatCard)}
        <div className="table-board">
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <path
              d={lobby.mode === 'duel' ? 'M3 3h8v8H3z' : 'M3 0h8v3h3v8h-3v3H3v-3H0V3h3z'}
              fill="var(--panel-2)"
              stroke="var(--border)"
              strokeWidth={0.15}
            />
            {seats.map((c) => {
              const r = HOME[lobby.mode][c]!;
              return (
                <rect key={c} x={r.x} y={r.y} width={r.w} height={r.h} rx={0.3} fill={COLOR_HEX[c]} opacity={lobby.seats[c] ? 0.95 : 0.22} />
              );
            })}
          </svg>
          <span className="muted small">
            {filled} / {seats.length} seated
          </span>
        </div>
      </div>

      <div className="room-actions">
        {isHost ? (
          <>
            <div className="room-actions-row">
              {!allFilled && (
                <button className="btn primary big" disabled={filling} onClick={fillWithAI}>
                  🤖 Fill {emptySeats.length === 1 ? 'the empty seat' : `${emptySeats.length} empty seats`} with AI
                </button>
              )}
              <button
                className={allFilled ? 'btn primary big' : 'btn big'}
                disabled={!allFilled}
                onClick={() => emit('lobby:start', { lobbyId: lobby.id })}
              >
                Start game
              </button>
            </div>
            {!allFilled && (
              <p className="muted small">Share the group code to invite players, or fill the remaining seats with AI.</p>
            )}
          </>
        ) : (
          <p className="muted">
            {allFilled ? 'Waiting for the host to start the game…' : `Waiting for players — ${filled} of ${seats.length} seated.`}
          </p>
        )}
      </div>
    </div>
  );
}
