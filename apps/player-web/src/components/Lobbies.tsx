import { useEffect, useState } from 'react';
import type { Color, Mode } from '@four-chess/engine';
import { MODE_LABEL } from '@four-chess/engine';
import { fetchLeaderboard, fetchMyGames, User } from '../api';
import { COLOR_HEX } from '../config';
import { LobbyView } from '../types';

interface HistoryGame {
  id: string;
  mode: Mode;
  status: 'active' | 'finished' | 'abandoned';
  groupName: string | null;
  players: { color: Color; userId?: string; username: string; ai: boolean }[];
  winners: Color[] | null;
  scores: Record<Color, number> | null;
  movesCount: number;
  startedAt: string;
}

interface LeaderboardRow {
  userId: string;
  username: string;
  points: number;
  wins: number;
  games: number;
}

interface LiveGameRow {
  id: string;
  groupName: string;
  mode: Mode;
  open: boolean;
  powers: boolean;
  ply: number;
  players: { color: Color; name: string }[];
  startedAt: number;
}

export function Lobbies({
  me,
  lobbies,
  connected,
  emit,
  onCreate,
  onJoin,
  onWatch,
}: {
  me: User;
  lobbies: LobbyView[];
  connected: boolean;
  emit: (event: string, payload?: Record<string, unknown>) => Promise<any>;
  onCreate: (name: string, mode: Mode, open: boolean, autopilot: boolean, powers: boolean) => void;
  onJoin: (lobbyId: string) => void;
  onWatch: (gameId: string) => void;
}) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<Mode>('ffa');
  const [open, setOpen] = useState(true);
  const [autopilot, setAutopilot] = useState(false);
  const [powers, setPowers] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  useEffect(() => {
    if (!showCreate) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowCreate(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCreate]);

  const submitCreate = () => {
    onCreate(name, mode, open, autopilot, powers);
    setShowCreate(false);
  };
  const [myGames, setMyGames] = useState<HistoryGame[] | null>(null);
  const [board, setBoard] = useState<LeaderboardRow[] | null>(null);
  const [liveGames, setLiveGames] = useState<LiveGameRow[]>([]);

  useEffect(() => {
    fetchMyGames()
      .then((r) => setMyGames(r.games))
      .catch(() => setMyGames([]));
    fetchLeaderboard()
      .then((r) => setBoard(r.leaderboard))
      .catch(() => setBoard([]));
  }, []);

  // refresh whenever the lobby list changes (games starting/finishing
  // trigger a lobbies broadcast)
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    emit('games:list').then((list) => {
      if (!cancelled && Array.isArray(list)) setLiveGames(list);
    });
    return () => {
      cancelled = true;
    };
  }, [connected, emit, lobbies]);

  const myColorOf = (g: HistoryGame): Color | undefined =>
    g.players.find((p) => p.userId === me.id)?.color;
  const myPoints = (g: HistoryGame): number => {
    const c = myColorOf(g);
    return c && g.scores ? (g.scores[c] ?? 0) : 0;
  };
  const finished = (myGames ?? []).filter((g) => g.status === 'finished');
  const totalPoints = finished.reduce((s, g) => s + myPoints(g), 0);
  const wins = finished.filter((g) => {
    const c = myColorOf(g);
    return c && g.winners?.includes(c);
  }).length;

  const resultLabel = (g: HistoryGame): { text: string; cls: string } => {
    if (g.status === 'active') return { text: 'in progress', cls: 'live' };
    if (g.status === 'abandoned') return { text: 'abandoned', cls: 'muted' };
    const c = myColorOf(g);
    return c && g.winners?.includes(c) ? { text: 'Won 🏆', cls: 'won' } : { text: 'Lost', cls: 'lost' };
  };

  return (
    <div className="lobbies">
      <div className="lobby-toolbar">
        <h2>Games</h2>
        <button className="btn primary" onClick={() => setShowCreate(true)}>
          + Create game
        </button>
      </div>

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-game-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2 id="create-game-title">Create game</h2>
              <button className="btn subtle small" aria-label="Close" onClick={() => setShowCreate(false)}>
                ✕
              </button>
            </div>
            <div className="modal-form">
              <input
                autoFocus
                placeholder="Group name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitCreate()}
                maxLength={30}
              />
              <div className="seg seg-full">
                <button className={mode === 'ffa' ? 'seg-btn active' : 'seg-btn'} onClick={() => setMode('ffa')}>
                  4 vs 4
                </button>
                <button className={mode === 'teams' ? 'seg-btn active' : 'seg-btn'} onClick={() => setMode('teams')}>
                  Tag team 2 vs 2
                </button>
                <button className={mode === 'duel' ? 'seg-btn active' : 'seg-btn'} onClick={() => setMode('duel')}>
                  1 vs 1
                </button>
              </div>
              <label className="check">
                <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
                Open (listed publicly)
              </label>
              <label className="check" title="The AI makes your moves while you watch. You can take over any time during the game.">
                <input type="checkbox" checked={autopilot} onChange={(e) => setAutopilot(e.target.checked)} />
                🤖 AI plays my moves (watch mode)
              </label>
              <label
                className="check"
                title="Every player gets five single-use powers: Fainted trap, Shield, Land Mine, Fortress, Teleport. Powers are free actions you set on your turn before moving; effects wear off after 6 opponent moves."
              >
                <input type="checkbox" checked={powers} onChange={(e) => setPowers(e.target.checked)} />
                ⚡ Powers
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn subtle" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={submitCreate}>
                Create game
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="home-grid">
        <section className="panel">
          <h2>📊 My record</h2>
          <div className="stat-chips">
            <div className="stat-chip">
              <div className="stat-chip-value">{totalPoints}</div>
              <div className="muted small">points</div>
            </div>
            <div className="stat-chip">
              <div className="stat-chip-value">{wins}</div>
              <div className="muted small">wins</div>
            </div>
            <div className="stat-chip">
              <div className="stat-chip-value">{finished.length}</div>
              <div className="muted small">games</div>
            </div>
          </div>
          {myGames === null ? (
            <p className="muted small">Loading…</p>
          ) : myGames.length === 0 ? (
            <p className="muted small">No games yet — create a group above and play your first one!</p>
          ) : (
            <div className="game-history">
              {myGames.slice(0, 8).map((g) => {
                const r = resultLabel(g);
                const c = myColorOf(g);
                return (
                  <div key={g.id} className="game-row">
                    {c && <span className="color-chip" style={{ background: COLOR_HEX[c] }} />}
                    <span className="game-row-name">{g.groupName ?? 'Game'}</span>
                    <span className="muted small">{g.mode === 'ffa' ? '4 vs 4' : g.mode === 'duel' ? '1 vs 1' : '2 vs 2'}</span>
                    <span className={`game-row-result ${r.cls}`}>{r.text}</span>
                    <span className="game-row-pts">{g.scores ? `+${myPoints(g)} pt` : '—'}</span>
                    <span className="muted small">{g.startedAt.slice(0, 10)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel">
          <h2>🏆 Leaderboard</h2>
          {board === null ? (
            <p className="muted small">Loading…</p>
          ) : board.length === 0 ? (
            <p className="muted small">No finished games yet.</p>
          ) : (
            <div className="game-history">
              {board.slice(0, 10).map((r, i) => (
                <div key={r.userId} className={`game-row ${r.userId === me.id ? 'me-row' : ''}`}>
                  <span className="lb-rank">{i + 1}</span>
                  <span className="game-row-name">
                    {r.username}
                    {r.userId === me.id ? ' (you)' : ''}
                  </span>
                  <span className="game-row-pts">{r.points} pt</span>
                  <span className="muted small">
                    {r.wins} win{r.wins === 1 ? '' : 's'} · {r.games} game{r.games === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {liveGames.length > 0 && (
        <section className="panel">
          <h2>📺 Live games</h2>
          <div className="lobby-list">
            {liveGames.map((g) => (
              <div key={g.id} className="lobby-card">
                <div>
                  <div className="lobby-name">
                    {g.groupName}
                    {!g.open && ' 🔒'}
                  </div>
                  <div className="muted small">
                    {MODE_LABEL[g.mode]}
                    {g.powers ? ' · ⚡' : ''} · move {g.ply} ·{' '}
                    {g.players.map((p) => p.name).join(' vs ')}
                  </div>
                </div>
                <button className="btn" onClick={() => onWatch(g.id)}>
                  Watch
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Open groups</h2>
        {lobbies.length === 0 && <p className="muted">No open groups right now — create one and add AI players!</p>}
        <div className="lobby-list">
          {lobbies.map((l) => (
            <div key={l.id} className="lobby-card">
              <div>
                <div className="lobby-name">{l.name}</div>
                <div className="muted small">
                  {MODE_LABEL[l.mode]}
                  {l.powers ? ' · ⚡ powers' : ''} · {l.filledCount}/{l.mode === 'duel' ? 2 : 4} seats ·{' '}
                  {l.humanCount} human{l.humanCount === 1 ? '' : 's'}
                </div>
              </div>
              <button className="btn" onClick={() => onJoin(l.id)} disabled={l.filledCount >= 4}>
                {l.filledCount >= 4 ? 'Full' : 'Join'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Join by code</h2>
        <div className="create-row">
          <input placeholder="Group code (e.g. a1b2c3d4)" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
          <button className="btn" onClick={() => joinCode.trim() && onJoin(joinCode.trim())}>
            Join
          </button>
        </div>
      </section>
    </div>
  );
}
