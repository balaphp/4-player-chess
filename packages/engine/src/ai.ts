import { FourChess } from './game.js';
import { Color, Move, PIECE_VALUE, PieceType, Pos, SIZE } from './types.js';

export type AIDifficulty = 'easy' | 'medium';

const CENTER = (SIZE - 1) / 2;

function centrality(p: Pos): number {
  // 0 at the corners of the cross, ~1 in the middle.
  const d = Math.abs(p.x - CENTER) + Math.abs(p.y - CENTER);
  return 1 - d / (SIZE - 1);
}

function cheb(a: Pos, b: Pos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// Greedy one-ply move chooser. "easy" is random-ish with a taste for captures,
// "medium" scores every legal move: material, safety, development, repetition
// avoidance, and a king hunt once an opponent is nearly out of pieces.
export function chooseAIMove(game: FourChess, color: Color, difficulty: AIDifficulty = 'medium'): Move | null {
  const moves = game.legalMoves(color);
  if (moves.length === 0) return null;

  if (difficulty === 'easy') {
    const captures = moves.filter((m) => game.pieceAt(m.to));
    const pool = captures.length && Math.random() < 0.7 ? captures : moves;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const lastOwn = [...game.history].reverse().find((h) => h.color === color);
  const recentOwn = game.history.filter((h) => h.color === color).slice(-6);

  // hunt the weakest enemy king; the barer they are, the harder we converge
  const nonKingMaterial = (c: Color): number => {
    let total = 0;
    for (const row of game.board) {
      for (const p of row) {
        if (p && p.color === c && !p.dead && p.type !== 'K') total += PIECE_VALUE[p.type as PieceType];
      }
    }
    return total;
  };
  let huntTarget: Pos | null = null;
  let huntColor: Color | null = null;
  let huntWeight = 0;
  const enemies = game.alive.filter((c) => game.isEnemy(c, color));
  let weakest = Infinity;
  for (const c of enemies) {
    const mat = nonKingMaterial(c);
    if (mat < weakest) {
      const king = game.kingPos(c);
      if (king) {
        weakest = mat;
        huntTarget = king;
        huntColor = c;
      }
    }
  }
  if (huntTarget) huntWeight = weakest <= 3 ? 3.5 : weakest <= 9 ? 1.5 : 0.6;
  // shrinking the hunted king's mobility is what actually produces mates
  const huntBaseMobility =
    huntColor && huntWeight >= 3.5 && game.countPieces(huntColor) <= 3 ? game.legalMoves(huntColor).length : null;

  let best: Move = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const mover = game.pieceAt(m.from)!;
    const target = game.pieceAt(m.to);
    let score = 0;

    if (target) {
      score += target.dead ? 0.5 : PIECE_VALUE[target.type] * 10; // grey pieces are just obstacles
    }
    if (m.promotion) score += 70;
    if (m.castle) score += 6;

    const preview = game.previewMove(color, m);
    if (preview.destAttacked) {
      // don't hang the piece; a defended square is a smaller gamble
      const risk = PIECE_VALUE[mover.type] * (preview.destDefended ? 4 : 9);
      score -= mover.type === 'K' ? 200 : risk;
    }
    score += preview.checksGiven.length * 5;
    score += preview.eliminationsGiven.length * 5000; // take the mate
    score += centrality(m.to) * 3;

    // get pawns and minors out early
    if (!mover.hasMoved && game.ply < 80 && (mover.type === 'P' || mover.type === 'N' || mover.type === 'B')) {
      score += 3.5;
    }
    if (mover.type === 'P') score += 0.6; // pawns only ever advance

    // anti-shuffle: no A->B->A, no replaying recent moves
    if (lastOwn && lastOwn.to.x === m.from.x && lastOwn.to.y === m.from.y) {
      score -= 2.5;
      if (lastOwn.from.x === m.to.x && lastOwn.from.y === m.to.y) score -= 14;
    }
    if (recentOwn.some((h) => h.from.x === m.from.x && h.from.y === m.from.y && h.to.x === m.to.x && h.to.y === m.to.y)) {
      score -= 6;
    }

    // close in on the hunted king; our own king only joins for the mating net
    if (huntTarget) {
      const gain = cheb(m.from, huntTarget) - cheb(m.to, huntTarget);
      const w = mover.type === 'K' ? (huntWeight >= 3.5 ? 2.5 : 0) : huntWeight;
      score += gain * w;
    }
    if (huntBaseMobility !== null && huntColor) {
      const after = preview.testedMobility[huntColor];
      if (after !== undefined) score += (huntBaseMobility - after) * 1.5; // tighten the net
    }

    if (mover.type === 'K' && !m.castle && huntWeight < 3.5) score -= 4; // keep the king at home
    if (mover.type === 'Q' && game.ply < 8) score -= 3; // don't develop the queen first
    score += Math.random() * 2;

    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}
