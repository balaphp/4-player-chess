import { type PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from 'react';
import type { Color, GameJSON, Move, Pos, Trap } from '@four-chess/engine';
import { DUEL_OFFSET, FILES, FourChess, inBoardForMode, opponentMovesLeft, SIZE } from '@four-chess/engine';
import { COLOR_HEX } from '../config';
import { PieceIcon } from './PieceIcons';

const S = 40; // square size in svg units
const PIECE_SCALE = (S * 0.92) / 45;
// how far (in screen pixels) a press must travel before it becomes a drag
const DRAG_THRESHOLD = 5;

// rotate board coords so the viewer's side ends up at the bottom of the screen
function toScreen(view: Color, p: Pos): { sx: number; sy: number } {
  let rx: number, ry: number;
  switch (view) {
    case 'red':
      rx = p.x; ry = p.y; break;
    case 'blue':
      rx = 13 - p.y; ry = p.x; break;
    case 'yellow':
      rx = 13 - p.x; ry = 13 - p.y; break;
    case 'green':
      rx = p.y; ry = 13 - p.x; break;
  }
  return { sx: rx, sy: 13 - ry };
}

function fromScreen(view: Color, sx: number, sy: number): Pos {
  const rx = sx;
  const ry = 13 - sy;
  switch (view) {
    case 'red':
      return { x: rx, y: ry };
    case 'blue':
      return { x: ry, y: 13 - rx };
    case 'yellow':
      return { x: 13 - rx, y: 13 - ry };
    case 'green':
      return { x: 13 - ry, y: rx };
  }
}

// polygon points for a from→to arrow between two square centres
function arrowPoints(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const start = S * 0.28, headLen = S * 0.42, headW = S * 0.24, shaftW = S * 0.09;
  const sx = x1 + ux * start, sy = y1 + uy * start;
  const ex = x2 - ux * S * 0.08, ey = y2 - uy * S * 0.08;
  const bx = ex - ux * headLen, by = ey - uy * headLen;
  return [
    [sx + nx * shaftW, sy + ny * shaftW],
    [bx + nx * shaftW, by + ny * shaftW],
    [bx + nx * headW, by + ny * headW],
    [ex, ey],
    [bx - nx * headW, by - ny * headW],
    [bx - nx * shaftW, by - ny * shaftW],
    [sx - nx * shaftW, sy - ny * shaftW],
  ]
    .map((p) => p.join(','))
    .join(' ');
}

const keyOf = (p: Pos) => `${p.x},${p.y}`;
const same = (a: Pos | null | undefined, b: Pos) => !!a && a.x === b.x && a.y === b.y;

// a piece picked up with the pointer; x/y follow it in svg units
interface Drag {
  from: Pos;
  x: number;
  y: number;
  moved: boolean;
  wasSelected: boolean; // already selected before this press
}

export function Board({
  state,
  myColor,
  onMove,
  locked = false,
  myTraps = [],
  onSquarePick,
}: {
  state: GameJSON;
  myColor: Color | null;
  onMove: (move: Move) => void;
  locked?: boolean; // autopilot is playing this seat -> view-only
  myTraps?: Trap[]; // the viewer's own secret traps
  onSquarePick?: (pos: Pos) => void; // power targeting: clicks report the square
}) {
  const view: Color = myColor ?? 'red';
  const [selected, setSelected] = useState<Pos | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pressRef = useRef<{ x: number; y: number } | null>(null);

  const engine = useMemo(() => FourChess.fromJSON(state), [state]);
  const myTurn = !locked && myColor !== null && state.turn === myColor && !state.winners;

  const legalTargets = useMemo(() => {
    if (!selected || !myColor) return [];
    return engine.legalMovesFrom(myColor, selected);
  }, [engine, selected, myColor]);

  const pieceMap = useMemo(() => {
    const m = new Map<string, GameJSON['pieces'][number]>();
    for (const p of state.pieces) m.set(`${p.x},${p.y}`, p);
    return m;
  }, [state.pieces]);

  const checkedKings = useMemo(() => {
    const set = new Set<string>();
    for (const p of state.pieces) {
      if (p.type === 'K' && !p.dead && state.inCheck.includes(p.color)) set.add(`${p.x},${p.y}`);
    }
    return set;
  }, [state]);

  const isMine = (pos: Pos) => {
    const piece = pieceMap.get(keyOf(pos));
    return !!piece && !piece.dead && piece.color === myColor;
  };
  const canDrag = myTurn && !onSquarePick;

  const handleClick = (sx: number, sy: number) => {
    const pos = fromScreen(view, sx, sy);
    if (!inBoardForMode(state.mode, pos.x, pos.y)) return;
    if (onSquarePick) {
      onSquarePick(pos);
      setSelected(null);
      return;
    }
    const target = legalTargets.find((m) => same(m.to, pos));
    if (target) {
      onMove(target);
      setSelected(null);
      return;
    }
    if (isMine(pos) && myTurn) {
      setSelected(same(selected, pos) ? null : pos);
    } else {
      setSelected(null);
    }
  };

  // ---- drag and drop ----

  const svgPoint = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const squareAt = (x: number, y: number): Pos | null => {
    const sx = Math.floor(x / S);
    const sy = Math.floor(y / S);
    if (sx < 0 || sy < 0 || sx >= SIZE || sy >= SIZE) return null;
    const pos = fromScreen(view, sx, sy);
    return inBoardForMode(state.mode, pos.x, pos.y) ? pos : null;
  };

  // Pressing one of your pieces selects it, so its moves show while you drag.
  // From here the pointer belongs to the board until it is released.
  const onPiecePointerDown = (e: ReactPointerEvent, pos: Pos) => {
    if (!canDrag || !isMine(pos)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const at = svgPoint(e);
    if (!at) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    pressRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ from: pos, x: at.x, y: at.y, moved: false, wasSelected: same(selected, pos) });
    setSelected(pos);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const at = svgPoint(e);
    const press = pressRef.current;
    if (!at || !press) return;
    const moved = drag.moved || Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD;
    setDrag({ ...drag, x: at.x, y: at.y, moved });
  };

  const endDrag = (e: ReactPointerEvent, dropped: boolean) => {
    if (!drag) return;
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
    const { from, moved, wasSelected } = drag;
    setDrag(null);
    pressRef.current = null;
    if (!moved) {
      // a plain click on your own piece: it stays selected, or unselects if it already was
      if (wasSelected) setSelected(null);
      return;
    }
    const at = dropped ? svgPoint(e) : null;
    const target = at ? squareAt(at.x, at.y) : null;
    // put back on its own square, or released off the board: nothing happens
    if (!target || same(from, target)) return;
    const move = legalTargets.find((m) => same(m.to, target));
    if (move) onMove(move);
    setSelected(null);
  };

  const lifted = drag?.moved ? drag.from : null;
  const hover = drag?.moved ? squareAt(drag.x, drag.y) : null;
  const hoverIsLegal = !!hover && legalTargets.some((m) => same(m.to, hover));

  // ---- drawing ----

  const squares = [];
  const pieces = [];
  const overlays = [];
  const badges = [];
  const last = state.lastMove;
  const active = <T extends { until: number }>(list: T[] | undefined) => (list ?? []).filter((e) => e.until > state.ply);
  const wallMap = new Map(active(state.walls).map((w) => [keyOf(w), w] as const));
  const shieldMap = new Map(active(state.shields).map((s) => [keyOf(s), s] as const));
  const trapMap = new Map(myTraps.map((t) => [keyOf(t), t] as const));

  // the opponent moves left before a power disappears, in the square's corner
  const countdown = (key: string, sx: number, sy: number, left: number) => (
    <g key={key} pointerEvents="none">
      <rect x={sx * S + S - 15} y={sy * S + S - 13} width={13} height={11} rx={3} fill="#0b0e14" opacity={0.88} />
      <text
        x={sx * S + S - 8.5}
        y={sy * S + S - 7.2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={8.5}
        fontWeight={700}
        fill="#f8fafc"
      >
        {left}
      </text>
    </g>
  );

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!inBoardForMode(state.mode, x, y)) continue;
      const here = { x, y };
      const key = keyOf(here);
      const { sx, sy } = toScreen(view, here);
      const light = (x + y) % 2 === 0;
      const isLast = last && (same(last.from, here) || same(last.to, here));
      const isSel = same(selected, here);
      const inCheckSq = checkedKings.has(key);
      squares.push(
        <rect
          key={`sq${x}-${y}`}
          x={sx * S}
          y={sy * S}
          width={S}
          height={S}
          fill={inCheckSq ? '#b91c1c' : isSel ? '#5eead4' : isLast ? (light ? '#d8c96b' : '#a89a4a') : light ? '#f0f0ed' : '#2e2e33'}
          onClick={() => handleClick(sx, sy)}
        />,
      );

      // Powers: walls, shields, own secret traps, each with its countdown.
      let left: number | null = null;
      const wall = wallMap.get(key);
      if (wall) {
        left = opponentMovesLeft(state, wall.until, wall.color);
        badges.push(
          <text key={`w${x}-${y}`} x={sx * S + S / 2} y={sy * S + S / 2 + 1} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.62} pointerEvents="none">
            🧱
          </text>,
        );
      }
      const p = pieceMap.get(key);
      const shield = shieldMap.get(key);
      if (shield) {
        left = opponentMovesLeft(state, shield.until, shield.color);
        badges.push(
          <rect key={`sh${x}-${y}`} x={sx * S + 2} y={sy * S + 2} width={S - 4} height={S - 4} rx={4} fill="none" stroke={COLOR_HEX[shield.color]} strokeWidth={2} opacity={0.9} pointerEvents="none" />,
        );
        if (!p) {
          badges.push(
            <text key={`shi${x}-${y}`} x={sx * S + S / 2} y={sy * S + S / 2 + 1} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.5} opacity={0.75} pointerEvents="none">
              🛡
            </text>,
          );
        }
      }
      const trap = trapMap.get(key);
      if (trap) {
        if (trap.expires !== undefined) left = opponentMovesLeft(state, trap.expires, trap.color);
        badges.push(
          <text key={`tr${x}-${y}`} x={sx * S + S / 2} y={sy * S + S / 2 + 1} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.5} opacity={0.6} pointerEvents="none">
            {trap.type === 'faint' ? '😴' : trap.type === 'teleport' ? '🌀' : '💣'}
          </text>,
        );
      }

      if (p) {
        const frozen = (p.frozenUntil ?? 0) > state.ply;
        const status = frozen ? '😴' : shield && shield.color === p.color ? '🛡' : null;
        if (status) {
          badges.push(
            <text key={`fx${x}-${y}`} x={sx * S + S - 8} y={sy * S + 9} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.34} pointerEvents="none">
              {status}
            </text>,
          );
        }
        // a sleeping piece counts the moves, by anyone, until it wakes
        if (frozen && left === null) left = p.frozenUntil! - state.ply;
        const draggable = canDrag && isMine(here);
        pieces.push(
          <g
            key={`p${x}-${y}`}
            transform={`translate(${sx * S + S * 0.04}, ${sy * S + S * 0.04}) scale(${PIECE_SCALE})`}
            fill={p.dead ? '#6b7280' : COLOR_HEX[p.color]}
            stroke={p.dead ? '#374151' : '#1f2937'}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{
              cursor: draggable ? 'grab' : 'default',
              opacity: same(lifted, here) ? 0.25 : p.dead ? 0.55 : 1,
              // a touch on your own piece drags it instead of scrolling the page
              touchAction: draggable ? 'none' : undefined,
            }}
            onPointerDown={(e) => onPiecePointerDown(e, here)}
            onClick={() => handleClick(sx, sy)}
          >
            <PieceIcon type={p.type} />
          </g>,
        );
      }

      if (left !== null && left > 0) badges.push(countdown(`cd${x}-${y}`, sx, sy, left));
    }
  }

  for (const m of legalTargets) {
    const { sx, sy } = toScreen(view, m.to);
    const isCapture = !!pieceMap.get(keyOf(m.to));
    overlays.push(
      isCapture ? (
        <circle
          key={`t${m.to.x}-${m.to.y}`}
          cx={sx * S + S / 2}
          cy={sy * S + S / 2}
          r={S * 0.44}
          fill="none"
          stroke="#14b8a6"
          strokeWidth={3.5}
          pointerEvents="none"
        />
      ) : (
        <circle
          key={`t${m.to.x}-${m.to.y}`}
          cx={sx * S + S / 2}
          cy={sy * S + S / 2}
          r={S * 0.16}
          fill="#14b8a6"
          opacity={0.85}
          pointerEvents="none"
        />
      ),
    );
  }

  // the square a dragged piece would land on, when that is a legal move
  if (hover && hoverIsLegal) {
    const { sx, sy } = toScreen(view, hover);
    overlays.push(
      <rect
        key="drop"
        x={sx * S + 1.5}
        y={sy * S + 1.5}
        width={S - 3}
        height={S - 3}
        fill="rgba(20, 184, 166, 0.28)"
        stroke="#14b8a6"
        strokeWidth={3}
        pointerEvents="none"
      />,
    );
  }

  // Coordinate labels (files a-n, ranks 1-14, matching move notation), drawn
  // in the dark gutter just outside the outermost square of each column/row so
  // they follow the cross shape and the per-seat rotation.
  const coordLabels = [];
  {
    const validAt = (sx: number, sy: number) => {
      const p = fromScreen(view, sx, sy);
      return inBoardForMode(state.mode, p.x, p.y);
    };
    const bottomOf: (number | null)[] = [];
    const leftOf: (number | null)[] = [];
    for (let sx = 0; sx < SIZE; sx++) {
      bottomOf[sx] = null;
      for (let sy = SIZE - 1; sy >= 0; sy--) if (validAt(sx, sy)) { bottomOf[sx] = sy; break; }
    }
    for (let sy = 0; sy < SIZE; sy++) {
      leftOf[sy] = null;
      for (let sx = 0; sx < SIZE; sx++) if (validAt(sx, sy)) { leftOf[sy] = sx; break; }
    }
    // Does the file (x) vary along the bottom edge in this rotation?
    const a = fromScreen(view, 6, bottomOf[6] ?? 13);
    const b = fromScreen(view, 7, bottomOf[7] ?? 13);
    const filesAcross = a.x !== b.x;
    const off = state.mode === 'duel' ? DUEL_OFFSET : 0;
    const labelText = (p: { x: number; y: number }, horizontal: boolean) =>
      horizontal === filesAcross ? FILES[p.x - off] : String(p.y + 1 - off);
    for (let sx = 0; sx < SIZE; sx++) {
      const sy = bottomOf[sx];
      if (sy === null) continue;
      const p = fromScreen(view, sx, sy);
      coordLabels.push(
        <text key={`cf${sx}`} x={sx * S + S / 2} y={(sy + 1) * S + 13} textAnchor="middle" fontSize={11}
          fontWeight={600} fill="#a8a29e" pointerEvents="none">
          {labelText(p, true)}
        </text>,
      );
    }
    for (let sy = 0; sy < SIZE; sy++) {
      const sx = leftOf[sy];
      if (sx === null) continue;
      const p = fromScreen(view, sx, sy);
      coordLabels.push(
        <text key={`cr${sy}`} x={sx * S - 7} y={sy * S + S / 2} textAnchor="end" dominantBaseline="central"
          fontSize={11} fontWeight={600} fill="#a8a29e" pointerEvents="none">
          {labelText(p, false)}
        </text>,
      );
    }
  }

  // Duel plays on the central 8x8 window: crop the view to it. The margin
  // leaves room for the coordinate gutter.
  const M = 24;
  const vb =
    state.mode === 'duel'
      ? { x: 3 * S - M, y: 3 * S - M, size: 8 * S + 2 * M }
      : { x: -M, y: -M, size: SIZE * S + 2 * M };

  // Arrows: every move made since the viewer last moved, so nothing the other
  // players did is missed; just the latest move for spectators or right after
  // the viewer's own move.
  const realMoves = state.history.filter(
    (h) => !h.power && h.from.x >= 0 && (h.from.x !== h.to.x || h.from.y !== h.to.y),
  );
  let arrowMoves = realMoves.slice(-1);
  if (myColor && arrowMoves.length > 0 && arrowMoves[0].color !== myColor) {
    arrowMoves = [];
    for (let i = realMoves.length - 1; i >= 0 && arrowMoves.length < 3; i--) {
      if (realMoves[i].color === myColor) break;
      arrowMoves.unshift(realMoves[i]);
    }
  }
  // each arrow takes its mover's colour; the light halo keeps it readable on
  // any square and over pieces of the same colour
  const moveArrows = arrowMoves.map((m, i) => {
    const a = toScreen(view, m.from);
    const b = toScreen(view, m.to);
    const points = arrowPoints(a.sx * S + S / 2, a.sy * S + S / 2, b.sx * S + S / 2, b.sy * S + S / 2);
    return (
      <g key={`arrow${i}`} opacity={i === arrowMoves.length - 1 ? 0.95 : 0.7} pointerEvents="none">
        <polygon points={points} fill="none" stroke="#f8fafc" strokeWidth={3.4} strokeLinejoin="round" />
        <polygon points={points} fill={COLOR_HEX[m.color]} stroke="#0b0e14" strokeWidth={1.2} strokeLinejoin="round" />
      </g>
    );
  });

  // the piece in hand, drawn last so it floats above everything
  const liftedPiece = lifted ? pieceMap.get(keyOf(lifted)) : undefined;
  const LIFT = 1.15;
  const inHand = drag && liftedPiece && (
    <g
      transform={`translate(${drag.x - (S * 0.46) * LIFT}, ${drag.y - (S * 0.46) * LIFT}) scale(${PIECE_SCALE * LIFT})`}
      fill={COLOR_HEX[liftedPiece.color]}
      stroke="#1f2937"
      strokeWidth={1.6}
      strokeLinejoin="round"
      strokeLinecap="round"
      pointerEvents="none"
      style={{ filter: 'drop-shadow(0 4px 4px rgba(0, 0, 0, 0.55))' }}
    >
      <PieceIcon type={liftedPiece.type} />
    </g>
  );

  return (
    <svg
      ref={svgRef}
      className="board"
      viewBox={`${vb.x} ${vb.y} ${vb.size} ${vb.size}`}
      style={{ cursor: onSquarePick ? 'crosshair' : drag?.moved ? 'grabbing' : undefined }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, true)}
      onPointerCancel={(e) => endDrag(e, false)}
    >
      <rect x={vb.x} y={vb.y} width={vb.size} height={vb.size} rx={10} fill="#101319" />
      {squares}
      {coordLabels}
      {overlays}
      {pieces}
      {moveArrows}
      {badges}
      {inHand}
    </svg>
  );
}
