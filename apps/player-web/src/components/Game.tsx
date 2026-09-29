import { useEffect, useMemo, useRef, useState } from 'react';
import type { Color, GameJSON, Move, Pos, PowerAction, PowerId } from '@four-chess/engine';
import {
  ALL_POWERS,
  MODE_LABEL,
  opponentMovesLeft,
  POWER_INFO,
  powerInPlay,
  seatColors,
  TEAM_OF,
} from '@four-chess/engine';
import type { Socket } from 'socket.io-client';
import { User } from '../api';
import { COLOR_HEX } from '../config';
import { GameView, PrivateView } from '../types';
import { Board } from './Board';
import { Board3D } from './Board3D';
import { CallPanel } from './CallPanel';
import { ChatPanel } from './ChatPanel';

const NO_MOVES: Move[] = [];

export function Game({
  game,
  me,
  mine,
  socket,
  emit,
  onExit,
  onBackToRoom,
}: {
  game: GameView;
  me: User;
  mine: PrivateView | null; // what only this player may see of the game
  socket: Socket | null;
  emit: (event: string, payload?: Record<string, unknown>) => Promise<any>;
  onExit: () => void;
  onBackToRoom: () => void;
}) {
  const myColor = useMemo(
    () =>
      seatColors(game.mode).find((c) => {
        const s = game.seats[c];
        return s?.kind === 'human' && s.userId === me.id;
      }) ?? null,
    [game.seats, game.mode, me.id],
  );

  // The shared state holds no secret power. What this player may see of them
  // comes separately and is laid over it: their own walls and traps, the
  // walls their moves have run into, their unused powers.
  const secrets = mine && mine.gameId === game.id ? mine : null;
  const state = useMemo<GameJSON>(() => {
    if (!secrets || !myColor) return game.state;
    const unused = game.state.powers ?? { red: [], blue: [], yellow: [], green: [] };
    return {
      ...game.state,
      walls: secrets.walls,
      shields: secrets.shields,
      traps: secrets.traps,
      powers: { ...unused, [myColor]: secrets.powers },
    };
  }, [game.state, secrets, myColor]);
  const myTraps = secrets?.traps ?? [];
  // only for the position they were worked out for
  const extraMoves = secrets && secrets.ply === state.ply ? secrets.extraMoves : NO_MOVES;

  const mySeat = myColor ? game.seats[myColor] : null;
  const autopilot = mySeat?.kind === 'human' && !!mySeat.autopilot;

  const [view3d, setView3d] = useState(() => {
    try {
      return localStorage.getItem('fc_board3d') === '1';
    } catch {
      return false;
    }
  });
  const toggle3d = () => {
    setView3d((v) => {
      try {
        localStorage.setItem('fc_board3d', v ? '0' : '1');
      } catch {
        /* private mode */
      }
      return !v;
    });
  };

  // sidebar: the game itself, or talking to the other players
  const [tab, setTab] = useState<'game' | 'chat'>('game');
  const [unread, setUnread] = useState(0);
  const [inCall, setInCall] = useState(false);
  const openChat = () => {
    setTab('chat');
    setUnread(0);
  };

  // the move list shows piece moves only; using a power is not a move
  const moves = state.history.filter((h) => !h.power);

  const historyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight });
  }, [moves.length, tab]);

  const onMove = (move: Move) => {
    emit('game:move', { gameId: game.id, from: move.from, to: move.to, promotion: move.promotion });
  };

  // ---- powers ----
  const myPowers: PowerId[] = (myColor && state.powers?.[myColor]) || [];
  const [targeting, setTargeting] = useState<{ power: PowerId } | null>(null);
  const [hoveredPower, setHoveredPower] = useState<PowerId | null>(null);
  const myTurnNow = myColor !== null && state.turn === myColor && !state.winners;

  useEffect(() => {
    if (!myTurnNow || autopilot) setTargeting(null);
  }, [myTurnNow, autopilot, state.ply]);

  // opponent moves left before my use of a power disappears; 0 once it has
  const powerLeft = (pw: PowerId): number => {
    if (!myColor) return 0;
    const ends =
      pw === 'wall'
        ? (state.walls ?? []).filter((w) => w.color === myColor).map((w) => w.until)
        : pw === 'shield'
          ? (state.shields ?? []).filter((s) => s.color === myColor).map((s) => s.until)
          : myTraps.filter((t) => t.type === pw).map((t) => t.expires ?? 0);
    return Math.max(0, ...ends.map((until) => opponentMovesLeft(state, until, myColor)));
  };

  // one power at a time: nothing new can be set while one is in play
  const inPlay = myColor ? powerInPlay(state, myColor) : null;
  const waitFor = inPlay ? `your ${POWER_INFO[inPlay].name} is still in play` : null;

  const shownPower = targeting?.power ?? hoveredPower;
  const targetingHint = targeting
    ? targeting.power === 'shield'
      ? 'Click a square in your home rows to shield it'
      : 'Click an empty square'
    : null;

  const onSquarePick = (pos: Pos) => {
    if (!targeting) return;
    const action: PowerAction = { power: targeting.power, target: pos };
    setTargeting(null);
    emit('game:power', { gameId: game.id, action });
  };

  const seatLabel = (c: Color) => {
    const s = game.seats[c];
    if (!s) return '—';
    return s.kind === 'human' ? `${s.username}${s.autopilot ? ' 🤖' : ''}` : `AI (${s.difficulty})`;
  };

  const elimReason = (c: Color) => state.eliminated.find((e) => e.color === c)?.reason;

  const winnersText = state.winners
    ? state.winners.length === 0
      ? 'Draw'
      : game.mode === 'teams'
        ? `Team ${TEAM_OF[state.winners[0]] + 1} (${state.winners.join(' + ')}) wins!`
        : `${seatLabel(state.winners[0])} (${state.winners[0]}) wins!`
    : null;

  const iAmEliminated = myColor !== null && !state.alive.includes(myColor);

  return (
    <div className="game">
      <div className="board-col">
      <div className="board-toolbar">
        <div className="board-title">
          <h3>{game.groupName}</h3>
          <span className="muted small">{MODE_LABEL[game.mode]}</span>
        </div>
        <div className="board-toolbar-actions">
          <button className="btn subtle small" onClick={toggle3d}>
            {view3d ? '▦ 2D board' : '🧊 3D board'}
          </button>
        </div>
      </div>
      <div className="board-wrap">
        {view3d ? (
          <Board3D
            key={game.id}
            state={state}
            myColor={myColor}
            onMove={onMove}
            locked={autopilot}
            myTraps={myTraps}
            extraMoves={extraMoves}
            onSquarePick={targeting ? onSquarePick : undefined}
          />
        ) : (
          <Board
            state={state}
            myColor={myColor}
            onMove={onMove}
            locked={autopilot}
            myTraps={myTraps}
            extraMoves={extraMoves}
            onSquarePick={targeting ? onSquarePick : undefined}
          />
        )}
        {winnersText && (
          <div className="gameover">
            <div className="gameover-card">
              <h2>🏆 {winnersText}</h2>
              <div className="gameover-scores">
                {seatColors(game.mode).map((c) => (
                  <span key={c} className="move-chip" style={{ borderColor: COLOR_HEX[c] }}>
                    {seatLabel(c)}: {state.points?.[c] ?? 0} pt
                  </span>
                ))}
              </div>
              <div className="gameover-actions">
                {myColor && (
                  <button className="btn primary" onClick={onBackToRoom}>
                    Back to group
                  </button>
                )}
                <button className="btn subtle" onClick={onExit}>
                  Leave
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>

      <aside className="side">
        <div className="players">
          {seatColors(game.mode).map((c) => {
            const eliminated = elimReason(c);
            const isTurn = state.turn === c && !state.winners;
            return (
              <div key={c} className={`player-row ${isTurn ? 'turn' : ''} ${eliminated ? 'out' : ''}`}>
                <span className="color-chip" style={{ background: COLOR_HEX[c] }} />
                <span className="player-name">
                  {seatLabel(c)}
                  {c === myColor ? ' (you)' : ''}
                </span>
                <span className="player-pts" title="Points: captures + eliminations + wins">
                  {state.points?.[c] ?? 0} pt
                </span>
                <span className="player-status">
                  {eliminated ? `✗ ${eliminated}` : state.inCheck.includes(c) ? 'check!' : ''}
                </span>
                {game.mode === 'teams' && <span className="muted small">T{TEAM_OF[c] + 1}</span>}
              </div>
            );
          })}
        </div>

        <div className="side-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'game'}
            className={`side-tab ${tab === 'game' ? 'active' : ''}`}
            onClick={() => setTab('game')}
          >
            Game
          </button>
          <button
            role="tab"
            aria-selected={tab === 'chat'}
            className={`side-tab ${tab === 'chat' ? 'active' : ''}`}
            onClick={openChat}
          >
            Chat
            {inCall && <span className="tab-live" title="You are in a call" />}
            {unread > 0 && <span className="tab-badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
        </div>

        {/* Hidden, not removed, when the other tab shows: an ongoing call and
            the chat history must survive switching tabs. */}
        <div className="side-panel" role="tabpanel" hidden={tab !== 'chat'}>
          <CallPanel
            socket={socket}
            gameId={game.id}
            me={me}
            seats={game.seats}
            mode={game.mode}
            enabled={myColor !== null && !state.winners}
            onStatus={setInCall}
          >
            <ChatPanel
              socket={socket}
              emit={emit}
              gameId={game.id}
              me={me}
              canSend={myColor !== null && !state.winners}
              active={tab === 'chat'}
              onIncoming={() => setUnread((n) => n + 1)}
            />
          </CallPanel>
        </div>

        <div className="side-panel" role="tabpanel" hidden={tab !== 'game'}>
        {state.powersEnabled && myColor && !state.winners && !iAmEliminated && (
          <div className="powers-box">
            <div className="powers-row">
              {ALL_POWERS.map((pw) => {
                const info = POWER_INFO[pw];
                const used = !myPowers.includes(pw);
                const left = used ? powerLeft(pw) : 0;
                return (
                  <div
                    key={pw}
                    className={`power-btn-wrap ${used ? 'used' : ''} ${left > 0 ? 'active' : ''}`}
                    onMouseEnter={() => setHoveredPower(pw)}
                    onMouseLeave={() => setHoveredPower(null)}
                    onClick={() => setHoveredPower(pw)}
                  >
                    <button
                      className={`power-btn ${targeting?.power === pw ? 'targeting' : ''} ${used ? 'used' : ''}`}
                      disabled={used || autopilot || !myTurnNow || inPlay !== null}
                      title={!used && waitFor ? `One power at a time: ${waitFor}` : undefined}
                      onClick={() => setTargeting(targeting?.power === pw ? null : { power: pw })}
                    >
                      {info.icon}
                      {used && (
                        <span
                          className={`power-used-mark ${left > 0 ? 'counting' : ''}`}
                          title={left > 0 ? `Active: ${left} opponent move${left === 1 ? '' : 's'} left` : 'Used'}
                        >
                          {left > 0 ? left : '✓'}
                        </span>
                      )}
                    </button>
                    <span className="power-btn-label">{info.name}</span>
                  </div>
                );
              })}
            </div>
            {shownPower && (
              <div className="power-desc">
                {POWER_INFO[shownPower].hint}
                {!myPowers.includes(shownPower) &&
                  (powerLeft(shownPower) > 0 ? (
                    <strong> Active: {powerLeft(shownPower)} opponent moves left.</strong>
                  ) : (
                    <strong> Already used.</strong>
                  ))}
                {myPowers.includes(shownPower) && waitFor && <strong> Not yet: {waitFor}.</strong>}
              </div>
            )}
            {targeting && (
              <div className="targeting-hint">
                <span>
                  {POWER_INFO[targeting.power].icon} {POWER_INFO[targeting.power].name}: {targetingHint}
                </span>
                <button className="btn subtle small" onClick={() => setTargeting(null)}>
                  Cancel
                </button>
              </div>
            )}
            {!targeting && !shownPower && (
              <div className="muted small">
                {waitFor
                  ? `⚡ One power at a time: ${waitFor}.`
                  : "⚡ One use each, one at a time — set it before your move; it doesn't cost the move."}
              </div>
            )}
          </div>
        )}

        <div className="history" ref={historyRef}>
          {moves.map((h, i) => (
            <span
              key={i}
              className={`move-chip${i === moves.length - 1 ? ' latest' : ''}`}
              style={{ borderColor: COLOR_HEX[h.color] }}
            >
              {h.notation}
            </span>
          ))}
        </div>
        </div>

        <div className="side-actions">
          {myColor && !iAmEliminated && !state.winners && (
            <button
              className={autopilot ? 'btn primary' : 'btn'}
              title="When on, the AI makes your moves while you watch"
              onClick={() => emit('game:setAutopilot', { gameId: game.id, on: !autopilot })}
            >
              🤖 Autopilot: {autopilot ? 'ON' : 'OFF'}
            </button>
          )}
          {myColor && !iAmEliminated && !state.winners && (
            <button
              className="btn danger"
              onClick={() => {
                if (confirm('Resign this game?')) emit('game:resign', { gameId: game.id });
              }}
            >
              Resign
            </button>
          )}
          {(iAmEliminated || !myColor) && !state.winners && <div className="muted small">Spectating…</div>}
          <button className="btn subtle" onClick={onExit}>
            Leave game
          </button>
        </div>
      </aside>
    </div>
  );
}
