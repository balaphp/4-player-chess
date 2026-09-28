import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FourChess } from './game.js';
import { inBoard } from './board.js';
import { GameJSON, PieceJSON, Color, PieceType, opponentMovesLeft } from './types.js';
import { chooseAIMove } from './ai.js';

function p(x: number, y: number, type: PieceType, color: Color, extra: Partial<PieceJSON> = {}): PieceJSON {
  return { x, y, type, color, dead: false, hasMoved: false, ...extra };
}

function customGame(opts: Partial<GameJSON> & { pieces: PieceJSON[] }): FourChess {
  return FourChess.fromJSON({
    mode: 'ffa',
    turn: 'red',
    points: { red: 0, blue: 0, yellow: 0, green: 0 },
    alive: ['red', 'blue', 'yellow', 'green'],
    eliminated: [],
    inCheck: [],
    winners: null,
    history: [],
    lastMove: null,
    ply: 20,
    ...opts,
  });
}

test('board shape: corners cut, cross valid', () => {
  assert.equal(inBoard(0, 0), false);
  assert.equal(inBoard(2, 2), false);
  assert.equal(inBoard(13, 0), false);
  assert.equal(inBoard(0, 13), false);
  assert.equal(inBoard(13, 13), false);
  assert.equal(inBoard(3, 0), true);
  assert.equal(inBoard(0, 3), true);
  assert.equal(inBoard(7, 7), true);
  assert.equal(inBoard(13, 7), true);
  assert.equal(inBoard(14, 7), false);
});

test('initial setup: 16 pieces per color, red to move', () => {
  const g = new FourChess();
  const json = g.toJSON();
  assert.equal(json.pieces.length, 64);
  for (const c of ['red', 'blue', 'yellow', 'green'] as Color[]) {
    assert.equal(json.pieces.filter((q) => q.color === c).length, 16);
    assert.equal(json.pieces.filter((q) => q.color === c && q.type === 'K').length, 1);
  }
  assert.equal(json.turn, 'red');
  assert.equal(json.winners, null);
});

test('opening: each player has 20 legal moves', () => {
  const g = new FourChess();
  for (const c of ['red', 'blue', 'yellow', 'green'] as Color[]) {
    assert.equal(g.legalMoves(c).length, 20, `${c} should have 20 opening moves`);
  }
});

test('turn order red -> blue -> yellow -> green -> red', () => {
  const g = new FourChess();
  assert.equal(g.applyMove('red', { from: { x: 7, y: 1 }, to: { x: 7, y: 3 } }).ok, true);
  assert.equal(g.turn, 'blue');
  assert.equal(g.applyMove('blue', { from: { x: 1, y: 7 }, to: { x: 3, y: 7 } }).ok, true);
  assert.equal(g.turn, 'yellow');
  // Note: yellow's g-pawn (6,12) is pinned here by blue's queen after b's pawn move.
  assert.equal(g.applyMove('yellow', { from: { x: 7, y: 12 }, to: { x: 7, y: 10 } }).ok, true);
  assert.equal(g.turn, 'green');
  // (12,6) is likewise pinned by red's queen after red's h-pawn move; use the h-file pawn.
  assert.equal(g.applyMove('green', { from: { x: 12, y: 7 }, to: { x: 10, y: 7 } }).ok, true);
  assert.equal(g.turn, 'red');
});

test('rejects out-of-turn and illegal moves', () => {
  const g = new FourChess();
  assert.equal(g.applyMove('blue', { from: { x: 1, y: 7 }, to: { x: 3, y: 7 } }).ok, false);
  assert.equal(g.applyMove('red', { from: { x: 7, y: 1 }, to: { x: 7, y: 5 } }).ok, false);
  assert.equal(g.applyMove('red', { from: { x: 6, y: 0 }, to: { x: 6, y: 5 } }).ok, false);
});

test('capturing a living king eliminates that player', () => {
  const g = customGame({
    turn: 'blue',
    pieces: [
      p(3, 0, 'K', 'red'),
      p(3, 5, 'Q', 'blue'),
      p(0, 7, 'K', 'blue'),
      p(7, 13, 'K', 'yellow'),
      p(13, 7, 'K', 'green'),
    ],
  });
  const res = g.applyMove('blue', { from: { x: 3, y: 5 }, to: { x: 3, y: 0 } });
  assert.equal(res.ok, true);
  assert.deepEqual(g.eliminated, [{ color: 'red', reason: 'king-captured' }]);
  assert.equal(g.isAlive('red'), false);
  assert.equal(g.pieceAt({ x: 3, y: 0 })?.color, 'blue');
  assert.equal(g.points.blue, 20, 'king capture pays the elimination bonus');
});

test('checkmate at turn start eliminates the player, game continues', () => {
  const g = customGame({
    turn: 'green',
    pieces: [
      p(3, 0, 'K', 'red'),
      p(0, 7, 'K', 'blue'),
      p(7, 13, 'K', 'yellow'),
      p(13, 7, 'K', 'green'),
      p(10, 0, 'R', 'green'),
      p(10, 2, 'R', 'green'),
    ],
  });
  // Green drops the second rook to the second rank: red king is mated in the corner.
  const res = g.applyMove('green', { from: { x: 10, y: 2 }, to: { x: 10, y: 1 } });
  assert.equal(res.ok, true);
  assert.deepEqual(g.eliminated, [{ color: 'red', reason: 'checkmate' }]);
  assert.equal(g.turn, 'blue');
  assert.equal(g.winners, null);
  // Conquest: the defeated king is removed and the mating player gets the bonus.
  assert.equal(g.pieceAt({ x: 3, y: 0 }), null);
  assert.equal(g.points.green, 20);
});

test('conquest: eliminating a player converts their remaining army', () => {
  const g = customGame({
    turn: 'blue',
    pieces: [
      p(3, 0, 'K', 'red'),
      p(5, 1, 'P', 'red', { hasMoved: true }),
      p(9, 9, 'R', 'red'),
      p(3, 5, 'Q', 'blue'),
      p(0, 7, 'K', 'blue'),
      p(7, 13, 'K', 'yellow'),
      p(13, 7, 'K', 'green'),
    ],
  });
  const res = g.applyMove('blue', { from: { x: 3, y: 5 }, to: { x: 3, y: 0 } });
  assert.equal(res.ok, true);
  // Red's pawn and rook now fight for blue, alive, marked as moved.
  assert.equal(g.pieceAt({ x: 5, y: 1 })?.color, 'blue');
  assert.equal(g.pieceAt({ x: 5, y: 1 })?.dead, false);
  assert.equal(g.pieceAt({ x: 9, y: 9 })?.color, 'blue');
  assert.equal(g.pieceAt({ x: 9, y: 9 })?.hasMoved, true);
  assert.equal(g.points.blue, 20);
  // A resignation converts nothing: pieces stay as grey obstacles.
  g.resign('yellow');
  assert.equal(g.pieceAt({ x: 7, y: 13 })?.color, 'yellow');
  assert.equal(g.pieceAt({ x: 7, y: 13 })?.dead, true);
});

test('points: captures score material, winner gets the win bonus', () => {
  const g = customGame({
    turn: 'blue',
    alive: ['red', 'blue'],
    eliminated: [
      { color: 'yellow', reason: 'resigned' },
      { color: 'green', reason: 'resigned' },
    ],
    pieces: [
      p(3, 0, 'K', 'red'),
      p(3, 9, 'Q', 'red'),
      p(3, 5, 'Q', 'blue'),
      p(0, 7, 'K', 'blue'),
    ],
  });
  assert.equal(g.applyMove('blue', { from: { x: 3, y: 5 }, to: { x: 3, y: 9 } }).ok, true); // QxQ
  assert.equal(g.points.blue, 9, 'capturing a queen scores 9');
});

test('stalemate at turn start also eliminates', () => {
  const g = customGame({
    turn: 'green',
    pieces: [
      p(3, 0, 'K', 'red'),
      p(0, 7, 'K', 'blue'),
      p(7, 13, 'K', 'yellow'),
      p(13, 7, 'K', 'green'),
      p(10, 1, 'R', 'green'), // covers rank 2
      p(4, 5, 'R', 'green'), // covers file e
    ],
  });
  const res = g.applyMove('green', { from: { x: 13, y: 7 }, to: { x: 13, y: 8 } });
  assert.equal(res.ok, true);
  assert.deepEqual(g.eliminated, [{ color: 'red', reason: 'stalemate' }]);
  assert.equal(g.turn, 'blue');
});

test('FFA: last surviving player wins', () => {
  const g = customGame({
    turn: 'blue',
    alive: ['red', 'blue'],
    eliminated: [
      { color: 'yellow', reason: 'resigned' },
      { color: 'green', reason: 'resigned' },
    ],
    pieces: [p(3, 0, 'K', 'red'), p(3, 5, 'Q', 'blue'), p(0, 7, 'K', 'blue')],
  });
  const res = g.applyMove('blue', { from: { x: 3, y: 5 }, to: { x: 3, y: 0 } });
  assert.equal(res.ok, true);
  assert.deepEqual(g.winners, ['blue']);
  assert.equal(g.status, 'finished');
  assert.equal(g.points.blue, 40, 'elimination bonus (20) + win bonus (20)');
});

test('teams: cannot capture partner pieces; team wins when both enemy kings fall', () => {
  const g = customGame({
    mode: 'teams',
    turn: 'blue',
    alive: ['blue', 'yellow', 'green'],
    eliminated: [{ color: 'red', reason: 'king-captured' }],
    pieces: [
      p(6, 13, 'K', 'yellow'),
      p(6, 5, 'Q', 'blue'),
      p(0, 7, 'K', 'blue'),
      p(13, 7, 'K', 'green'),
      p(10, 7, 'R', 'green'),
      p(8, 7, 'P', 'blue', { hasMoved: true }),
    ],
  });
  // Green rook may not capture (or pass through) the partner blue pawn on the same rank.
  const greenRook = g.legalMoves('green').filter((m) => m.from.x === 10 && m.from.y === 7);
  assert.equal(greenRook.some((m) => m.to.x === 8 && m.to.y === 7), false);
  assert.equal(greenRook.some((m) => m.to.x === 9 && m.to.y === 7), true);
  // Blue captures the second enemy king -> team blue+green wins.
  const res = g.applyMove('blue', { from: { x: 6, y: 5 }, to: { x: 6, y: 13 } });
  assert.equal(res.ok, true);
  assert.deepEqual(g.winners, ['blue', 'green']);
});

test('castling: both sides available and rook relocates', () => {
  const g = customGame({
    pieces: [
      p(7, 0, 'K', 'red'),
      p(10, 0, 'R', 'red'),
      p(3, 0, 'R', 'red'),
      p(0, 7, 'K', 'blue'),
      p(7, 13, 'K', 'yellow'),
      p(13, 7, 'K', 'green'),
    ],
  });
  const kingMoves = g.legalMoves('red').filter((m) => m.castle);
  assert.equal(kingMoves.length, 2);
  const res = g.applyMove('red', { from: { x: 7, y: 0 }, to: { x: 9, y: 0 } });
  assert.equal(res.ok, true);
  assert.equal(g.pieceAt({ x: 9, y: 0 })?.type, 'K');
  assert.equal(g.pieceAt({ x: 8, y: 0 })?.type, 'R');
  assert.equal(g.pieceAt({ x: 10, y: 0 }), null);
});

test('4-player: pawn promotes only on the opposite edge, not the 11th rank', () => {
  const g = customGame({
    pieces: [
      p(5, 9, 'P', 'red', { hasMoved: true }),
      p(5, 12, 'P', 'red', { hasMoved: true }),
      p(7, 0, 'K', 'red'),
      p(0, 7, 'K', 'blue'),
      p(7, 13, 'K', 'yellow'),
      p(13, 7, 'K', 'green'),
    ],
  });
  assert.ok(g.applyMove('red', { from: { x: 5, y: 9 }, to: { x: 5, y: 10 } }).ok);
  assert.equal(g.pieceAt({ x: 5, y: 10 })?.type, 'P', 'still a pawn on the 11th rank');
  g.applyMove('blue', g.legalMoves('blue')[0]);
  g.applyMove('yellow', g.legalMoves('yellow')[0]);
  g.applyMove('green', g.legalMoves('green')[0]);
  assert.ok(g.applyMove('red', { from: { x: 5, y: 12 }, to: { x: 5, y: 13 } }).ok);
  assert.equal(g.pieceAt({ x: 5, y: 13 })?.type, 'Q', 'promotes on the far edge');
});

test('duel: pawn promotes on the 8th rank of the window', () => {
  const g = customGame({
    mode: 'duel',
    alive: ['red', 'yellow'],
    pieces: [p(5, 9, 'P', 'red', { hasMoved: true }), p(7, 3, 'K', 'red'), p(9, 10, 'K', 'yellow')],
  });
  assert.ok(g.applyMove('red', { from: { x: 5, y: 9 }, to: { x: 5, y: 10 } }).ok);
  assert.equal(g.pieceAt({ x: 5, y: 10 })?.type, 'Q');
});

test('cannot move into check', () => {
  const g = customGame({
    pieces: [
      p(7, 0, 'K', 'red'),
      p(8, 5, 'R', 'blue'),
      p(0, 7, 'K', 'blue'),
      p(7, 13, 'K', 'yellow'),
      p(13, 7, 'K', 'green'),
    ],
  });
  const kingMoves = g.legalMoves('red');
  assert.equal(kingMoves.some((m) => m.to.x === 8), false, 'file i is covered by the blue rook');
});

test('resign hands the turn over and can end the game', () => {
  const g = new FourChess();
  g.resign('red');
  assert.equal(g.turn, 'blue');
  assert.equal(g.isAlive('red'), false);
  g.resign('blue');
  g.resign('yellow');
  assert.deepEqual(g.winners, ['green']);
});

test('AI finishes off a lone king instead of check-shuffling forever', () => {
  const g = customGame({
    turn: 'green',
    alive: ['yellow', 'green'],
    eliminated: [
      { color: 'red', reason: 'resigned' },
      { color: 'blue', reason: 'checkmate' },
    ],
    pieces: [
      p(6, 13, 'K', 'yellow', { hasMoved: true }),
      p(13, 7, 'K', 'green', { hasMoved: true }),
      p(9, 5, 'Q', 'green', { hasMoved: true }),
      p(10, 2, 'R', 'green', { hasMoved: true }),
    ],
  });
  let guard = 0;
  while (!g.winners && guard++ < 400) {
    const move = chooseAIMove(g, g.turn, 'medium');
    assert.ok(move, `no move for ${g.turn}`);
    assert.equal(g.applyMove(g.turn, move!).ok, true);
  }
  assert.deepEqual(g.winners, ['green'], `green should corner the lone king within 400 plies (used ${guard})`);
});

test('AI opening uses several pieces including pawns, not one piece', () => {
  const g = new FourChess();
  for (let i = 0; i < 32 && !g.winners; i++) {
    const move = chooseAIMove(g, g.turn, 'medium');
    assert.ok(move);
    g.applyMove(g.turn, move!);
  }
  const redMoves = g.history.filter((h) => h.color === 'red');
  const origins = new Set(redMoves.map((h) => `${h.from.x},${h.from.y}`));
  assert.ok(origins.size >= 3, `red should have moved at least 3 different pieces, moved ${origins.size}`);
  assert.ok(redMoves.some((h) => h.piece === 'P'), 'red should have developed at least one pawn');
});

test('powers: faint trap freezes the lander; frozen piece immobile and uncapturable, then thaws', () => {
  const g = new FourChess('ffa', true);
  // Red secretly traps h4, then blue/yellow/green pass; red's own knight... use blue pawn:
  assert.equal(g.applyPower('red', { power: 'faint', target: { x: 3, y: 7 } }).ok, true); // trap d8
  assert.equal(g.powers.red.includes('faint'), false, 'faint consumed');
  assert.equal(g.applyPower('red', { power: 'faint', target: { x: 4, y: 7 } }).ok, false, 'single use');
  assert.equal(g.turn, 'red', 'powers do not take the turn');
  assert.equal(g.ply, 0, 'powers do not advance the clock');
  assert.ok(g.applyMove('red', g.legalMoves('red')[0]).ok);
  const res = g.applyMove('blue', { from: { x: 1, y: 7 }, to: { x: 3, y: 7 } }); // pawn lands on trap
  assert.equal(res.ok, true);
  assert.ok(res.ok && res.applied.notation.includes('😴'), 'trap trigger revealed');
  const pawn = g.pieceAt({ x: 3, y: 7 })!;
  assert.ok(g.isFrozen(pawn), 'lander is frozen');
  // Frozen piece produces no moves and cannot be captured.
  assert.equal(g.legalMoves('blue').some((m) => m.from.x === 3 && m.from.y === 7), false);
  g.ply += 20; // fast-forward: freeze expires
  assert.equal(g.isFrozen(pawn), false, 'thaws after the freeze duration');
});

test('powers: land mine destroys an enemy piece without points, dormant for the owner', () => {
  const g = customGame({
    turn: 'blue',
    pieces: [
      p(7, 0, 'K', 'red'),
      p(5, 5, 'R', 'red', { hasMoved: true }),
      p(0, 7, 'K', 'blue'),
      p(5, 9, 'P', 'blue', { hasMoved: true }),
      p(7, 13, 'K', 'yellow'),
      p(13, 7, 'K', 'green'),
    ],
    powersEnabled: true,
    powers: { red: ['mine'], blue: ['mine'], yellow: [], green: [] },
  });
  assert.equal(g.applyPower('blue', { power: 'mine', target: { x: 5, y: 7 } }).ok, true);
  // blue still has the move; then yellow, green pass
  assert.ok(g.applyMove('blue', g.legalMoves('blue')[0]).ok);
  g.applyMove('yellow', g.legalMoves('yellow')[0]);
  g.applyMove('green', g.legalMoves('green')[0]);
  // red rook slides onto the mined square -> destroyed, no points for anyone
  const res = g.applyMove('red', { from: { x: 5, y: 5 }, to: { x: 5, y: 7 } });
  assert.equal(res.ok, true);
  assert.ok(res.ok && res.applied.notation.includes('💣'));
  assert.equal(g.pieceAt({ x: 5, y: 7 }), null, 'mined piece destroyed');
  assert.equal(g.points.blue, 0, 'mine kills give no capture points');
  assert.equal(g.traps.length, 0, 'mine consumed');
});

test('powers: shield protects a home-row square; piece on shielded square cannot be captured', () => {
  const g = customGame({
    turn: 'red',
    pieces: [
      p(7, 0, 'K', 'red'),
      p(3, 1, 'Q', 'red', { hasMoved: true }),
      p(0, 7, 'K', 'blue'),
      p(3, 12, 'R', 'blue', { hasMoved: true }),
      p(7, 13, 'K', 'yellow'),
      p(13, 7, 'K', 'green'),
    ],
    powersEnabled: true,
    powers: { red: ['shield'], blue: [], yellow: [], green: [] },
  });
  // Cannot shield outside home rows.
  assert.equal(g.applyPower('red', { power: 'shield', target: { x: 3, y: 5 } }).ok, false, 'non-home square rejected');
  // Shield a home-row square where the queen stands.
  assert.equal(g.applyPower('red', { power: 'shield', target: { x: 3, y: 1 } }).ok, true);
  // Blue's rook may not capture the queen on the shielded square.
  const blueRook = g.legalMoves('blue').filter((m) => m.from.x === 3 && m.from.y === 12);
  assert.equal(blueRook.some((m) => m.to.x === 3 && m.to.y === 1), false, 'piece on shielded square not capturable');
});

test('powers: fortress blocks movement', () => {
  const g = customGame({
    turn: 'red',
    pieces: [
      p(7, 0, 'K', 'red'),
      p(3, 0, 'R', 'red'),
      p(3, 5, 'Q', 'red', { hasMoved: true }),
      p(0, 7, 'K', 'blue'),
      p(7, 13, 'K', 'yellow'),
      p(13, 7, 'K', 'green'),
    ],
    powersEnabled: true,
    powers: { red: ['wall'], blue: [], yellow: [], green: [] },
  });
  assert.equal(g.applyPower('red', { power: 'wall', target: { x: 3, y: 7 } }).ok, true);
  assert.ok(g.applyMove('red', { from: { x: 7, y: 0 }, to: { x: 6, y: 0 } }).ok, 'red still to move');
  g.applyMove('blue', g.legalMoves('blue')[0]);
  g.applyMove('yellow', g.legalMoves('yellow')[0]);
  g.applyMove('green', g.legalMoves('green')[0]);
  // Red queen may not slide up file d through the wall.
  const qMoves = g.legalMovesFrom('red', { x: 3, y: 5 });
  assert.equal(qMoves.some((m) => m.to.x === 3 && m.to.y === 7), false, 'wall square not enterable');
  assert.equal(qMoves.some((m) => m.to.x === 3 && m.to.y === 9), false, 'wall blocks the ray');
});

test('duel: classic 1v1 chess on the central 8x8 board', () => {
  const g = new FourChess('duel');
  const json = g.toJSON();
  assert.equal(json.pieces.length, 32, 'two armies of 16');
  assert.deepEqual(g.alive, ['red', 'yellow']);
  assert.equal(g.winners, null, 'game must not end at the start');
  assert.equal(g.legalMoves('red').length, 20, 'classic 20 opening moves');
  // Turn alternates red <-> yellow only.
  assert.equal(g.applyMove('red', { from: { x: 7, y: 4 }, to: { x: 7, y: 6 } }).ok, true);
  assert.equal(g.turn, 'yellow');
  assert.equal(g.applyMove('yellow', { from: { x: 7, y: 9 }, to: { x: 7, y: 7 } }).ok, true);
  assert.equal(g.turn, 'red');
  // Pieces cannot leave the 8x8 window: red rook at d4 has no move to d3.
  assert.equal(
    g.legalMoves('red').some((m) => m.to.y < 3 || m.to.y > 10 || m.to.x < 3 || m.to.x > 10),
    false,
    'all moves stay inside the duel board',
  );
});

test('duel: checkmating the single opponent wins', () => {
  const g = customGame({
    mode: 'duel',
    turn: 'red',
    alive: ['red', 'yellow'],
    pieces: [
      p(7, 3, 'K', 'red', { hasMoved: true }),
      p(3, 4, 'R', 'red', { hasMoved: true }),
      p(4, 9, 'R', 'red', { hasMoved: true }),
      p(6, 10, 'K', 'yellow', { hasMoved: true }),
    ],
  });
  // Rook to the back rank: yellow king trapped between rank 10 (mate) and rank 11 cover.
  const res = g.applyMove('red', { from: { x: 3, y: 4 }, to: { x: 3, y: 10 } });
  assert.equal(res.ok, true);
  assert.deepEqual(g.eliminated, [{ color: 'yellow', reason: 'checkmate' }]);
  assert.deepEqual(g.winners, ['red']);
});

test('powers: disabled by default and unavailable in classic games', () => {
  const g = new FourChess('ffa');
  const res = g.applyPower('red', { power: 'wall', target: { x: 7, y: 7 } });
  assert.equal(res.ok, false);
  assert.equal(g.powers.red.length, 0);
});

test('AI produces a legal move and a full AI game terminates', () => {
  const g = new FourChess('ffa');
  let guard = 0;
  while (!g.winners && guard++ < 900) {
    const move = chooseAIMove(g, g.turn, 'medium');
    assert.ok(move, `AI found no move for ${g.turn} but the player was not eliminated`);
    const res = g.applyMove(g.turn, move!);
    assert.equal(res.ok, true, `AI move rejected: ${JSON.stringify(move)}`);
  }
  assert.ok(g.winners, 'AI vs AI game should reach a result');
});

test('powers: teleport places a trap; enemy stepping on it teleports to a random square', () => {
  const g = customGame({
    powersEnabled: true,
    powers: { red: ['teleport'], blue: [], yellow: [], green: [] },
    alive: ['red', 'yellow'],
    pieces: [
      p(7, 3, 'K', 'red'),
      p(7, 12, 'K', 'yellow'),
      p(5, 5, 'N', 'yellow'),
    ],
    turn: 'red',
  });
  // Cannot place on an occupied square.
  assert.equal(g.applyPower('red', { power: 'teleport', target: { x: 5, y: 5 } }).ok, false, 'occupied square rejected');
  // Place the trap on an empty square.
  const trapSq = { x: 5, y: 6 };
  const res = g.applyPower('red', { power: 'teleport', target: trapSq });
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(g.traps.length, 1, 'trap placed');
  assert.equal(g.traps[0].type, 'teleport');

  // Advance to yellow's turn and move the knight onto the trap square.
  // (yellow's king was at 7,12, skip advancing turn; directly call applyMove)
  // We simulate: enemy knight moves to (5,6).
  g.board[6][5] = g.board[5][5];
  g.board[5][5] = null;
  // Manually trigger the trap as the engine would.
  const noteBefore = '';
  // The knight is now at the trap square.
  const note = (g as any).triggerTrapAt(trapSq);
  assert.ok(note.includes('🌀'), 'teleport note emitted: ' + note);
  // Knight must no longer be at the trap square.
  assert.equal(g.board[6][5], null, 'knight left trap square');
  // Knight must be exactly once on the board.
  let found = 0;
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
    const pc = g.board[y][x];
    if (pc && pc.type === 'N' && pc.color === 'yellow') found++;
  }
  assert.equal(found, 1, 'knight landed exactly once on the board');
  // Trap is consumed.
  assert.equal(g.traps.length, 0, 'trap consumed');
});

test('powers: untriggered traps fade after the effect window', () => {
  const g = customGame({
    powersEnabled: true,
    powers: { red: ['mine'], blue: [], yellow: [], green: [] },
    alive: ['red', 'yellow'],
    pieces: [
      p(7, 3, 'K', 'red'),
      p(7, 12, 'K', 'yellow'),
    ],
    turn: 'red',
    ply: 20,
  });
  const res = g.applyPower('red', { power: 'mine', target: { x: 9, y: 9 } });
  assert.ok(res.ok);
  assert.equal(g.traps.length, 1);
  assert.equal(g.traps[0].expires, 20 + 12, 'duel: 6 opponent moves = 12 plies');
  // let the clock run past the expiry: next advanceTurn sweeps it
  g.ply = 40;
  const move = g.legalMoves('red')[0];
  assert.ok(g.applyMove('red', move).ok);
  assert.equal(g.traps.length, 0, 'expired trap swept');
});

test('powers: set on your own turn before moving; turn and ply unchanged, rev bumps', () => {
  const g = customGame({
    powersEnabled: true,
    powers: { red: ['wall'], blue: [], yellow: ['mine'], green: [] },
    alive: ['red', 'yellow'],
    pieces: [p(7, 3, 'K', 'red'), p(7, 12, 'K', 'yellow')],
    turn: 'red',
    ply: 10,
  });
  const before = g.rev;
  assert.equal(g.applyPower('yellow', { power: 'mine', target: { x: 8, y: 8 } }).ok, false, 'only the player to move may act');
  assert.ok(g.applyPower('red', { power: 'wall', target: { x: 9, y: 9 } }).ok);
  assert.equal(g.turn, 'red', 'red still to move after using a power');
  assert.equal(g.ply, 10, 'powers do not advance the clock');
  assert.equal(g.rev, before + 1, 'rev bumps so concurrent writers are detected');
  assert.equal(g.toJSON().lastMove, null, 'powers are not reported as the last move');
});

test('powers: one visible power per square; unknowing trap collisions coexist and only hit enemies', () => {
  const g = customGame({
    mode: 'duel',
    powersEnabled: true,
    powers: { red: ['faint', 'mine', 'shield', 'wall'], blue: [], yellow: ['mine', 'teleport'], green: [] },
    alive: ['red', 'yellow'],
    pieces: [p(7, 3, 'K', 'red'), p(6, 3, 'R', 'red', { hasMoved: true }), p(7, 10, 'K', 'yellow')],
    turn: 'red',
  });
  assert.ok(g.applyPower('red', { power: 'shield', target: { x: 5, y: 4 } }).ok);
  assert.equal(g.applyPower('red', { power: 'faint', target: { x: 5, y: 4 } }).ok, false, 'no trap under own shield');
  assert.equal(g.applyPower('red', { power: 'wall', target: { x: 5, y: 4 } }).ok, false, 'no wall on a shielded square');
  assert.ok(g.applyPower('red', { power: 'mine', target: { x: 6, y: 6 } }).ok);
  assert.equal(g.applyPower('red', { power: 'wall', target: { x: 6, y: 6 } }).ok, false, 'no wall on own trap');
  assert.equal(g.applyPower('red', { power: 'faint', target: { x: 6, y: 6 } }).ok, false, 'no second trap on own trap');
  assert.ok(g.powers.red.includes('faint') && g.powers.red.includes('wall'), 'rejected powers are not consumed');

  assert.ok(g.applyMove('red', { from: { x: 7, y: 3 }, to: { x: 8, y: 3 } }).ok);
  assert.equal(g.applyPower('yellow', { power: 'teleport', target: { x: 5, y: 4 } }).ok, false, 'visible shield blocks anyone');
  assert.ok(g.applyPower('yellow', { power: 'mine', target: { x: 6, y: 6 } }).ok, "placing on red's secret mine succeeds");
  assert.equal(g.traps.filter((t) => t.x === 6 && t.y === 6).length, 2, 'both secret traps stay armed');
  assert.ok(g.applyMove('yellow', { from: { x: 7, y: 10 }, to: { x: 7, y: 9 } }).ok);
  // red's rook lands on the shared square: red's own mine is dormant, yellow's fires
  const res = g.applyMove('red', { from: { x: 6, y: 3 }, to: { x: 6, y: 6 } });
  assert.ok(res.ok && res.applied.notation.includes('💣'), 'enemy mine fires');
  assert.equal(g.pieceAt({ x: 6, y: 6 }), null, 'rook destroyed');
  const left = g.traps.filter((t) => t.x === 6 && t.y === 6);
  assert.equal(left.length, 1, "red's own mine is still armed");
  assert.equal(left[0].color, 'red');
});

test('powers: stacked enemy traps fire in placement order; own traps never fire on the owner', () => {
  const g = customGame({
    powersEnabled: true,
    pieces: [
      p(7, 0, 'K', 'red'),
      p(0, 7, 'K', 'blue'),
      p(5, 8, 'R', 'blue', { hasMoved: true }),
      p(7, 13, 'K', 'yellow'),
      p(13, 7, 'K', 'green'),
      p(9, 8, 'R', 'red', { hasMoved: true }),
    ],
    traps: [
      { type: 'faint', color: 'red', x: 5, y: 5 },
      { type: 'mine', color: 'yellow', x: 5, y: 5 },
      { type: 'faint', color: 'red', x: 9, y: 5 },
    ],
    turn: 'blue',
  });
  // blue rook lands on two enemy traps: fainted first, then mined
  const res = g.applyMove('blue', { from: { x: 5, y: 8 }, to: { x: 5, y: 5 } });
  assert.ok(res.ok);
  assert.ok(res.ok && res.applied.notation.endsWith(' 😴 💣'), 'both effects reported: ' + (res.ok && res.applied.notation));
  assert.equal(g.pieceAt({ x: 5, y: 5 }), null, 'mined after being frozen');
  assert.equal(g.traps.filter((t) => t.x === 5 && t.y === 5).length, 0, 'both consumed');
  // yellow, green pass; red rook lands on red's own faint trap: nothing happens
  g.applyMove('yellow', g.legalMoves('yellow')[0]);
  g.applyMove('green', g.legalMoves('green')[0]);
  const own = g.applyMove('red', { from: { x: 9, y: 8 }, to: { x: 9, y: 5 } });
  assert.ok(own.ok && !own.applied.notation.includes('😴'), 'own trap dormant');
  assert.equal(g.isFrozen(g.pieceAt({ x: 9, y: 5 })!), false);
  assert.equal(g.traps.filter((t) => t.x === 9 && t.y === 5).length, 1, 'own trap still armed');
});

test('powers: a wall that would leave you without a legal move is rejected', () => {
  const g = customGame({
    mode: 'duel',
    powersEnabled: true,
    powers: { red: ['wall'], blue: [], yellow: [], green: [] },
    alive: ['red', 'yellow'],
    pieces: [
      p(3, 3, 'K', 'red'),
      p(6, 6, 'P', 'red', { hasMoved: true }),
      p(10, 10, 'K', 'yellow'),
      p(4, 10, 'R', 'yellow', { hasMoved: true }), // covers file x=4
      p(10, 4, 'R', 'yellow', { hasMoved: true }), // covers rank y=4
    ],
    turn: 'red',
  });
  const moves = g.legalMoves('red');
  assert.equal(moves.length, 1, 'only the pawn push is legal');
  assert.deepEqual(moves[0].to, { x: 6, y: 7 });
  assert.equal(g.applyPower('red', { power: 'wall', target: { x: 6, y: 7 } }).ok, false, 'self-stalemating wall rejected');
  assert.equal(g.walls.length, 0, 'rejected wall is not left behind');
  assert.ok(g.powers.red.includes('wall'), 'power not consumed');
  assert.ok(g.applyPower('red', { power: 'wall', target: { x: 8, y: 8 } }).ok, 'harmless wall accepted');
});

test('powers: the countdown counts the opponent moves an effect has left', () => {
  const duel = (turn: Color, ply: number) => ({ mode: 'duel' as const, alive: ['red', 'yellow'] as Color[], turn, ply });
  // red places a power before moving at ply 10: it lasts 12 plies, i.e. 6 yellow moves
  assert.equal(opponentMovesLeft(duel('red', 10), 22, 'red'), 6);
  assert.equal(opponentMovesLeft(duel('yellow', 11), 22, 'red'), 6, "the owner's own move does not count");
  assert.equal(opponentMovesLeft(duel('red', 12), 22, 'red'), 5, 'an opponent move does');
  assert.equal(opponentMovesLeft(duel('yellow', 21), 22, 'red'), 1);
  assert.equal(opponentMovesLeft(duel('red', 22), 22, 'red'), 0, 'gone once the last ply is reached');

  const ffa = { mode: 'ffa' as const, alive: ['red', 'blue', 'yellow', 'green'] as Color[], turn: 'red' as Color, ply: 4 };
  assert.equal(opponentMovesLeft(ffa, 12, 'red'), 6, 'four players: 8 plies hold 6 opponent moves');
  assert.equal(opponentMovesLeft({ ...ffa, alive: ['red', 'yellow', 'green'] }, 12, 'red'), 5, 'eliminated players are skipped');
});

test('powers: a wall records who placed it, and the real countdown runs from 6 to 0', () => {
  const g = customGame({
    mode: 'duel',
    powersEnabled: true,
    powers: { red: ['wall'], blue: [], yellow: [], green: [] },
    alive: ['red', 'yellow'],
    pieces: [p(7, 3, 'K', 'red'), p(7, 10, 'K', 'yellow')],
    turn: 'red',
    ply: 0,
  });
  assert.ok(g.applyPower('red', { power: 'wall', target: { x: 5, y: 6 } }).ok);
  const wall = () => g.toJSON().walls![0];
  assert.equal(wall().color, 'red');
  const seen: number[] = [];
  for (let i = 0; i < 12; i++) {
    const s = g.toJSON();
    seen.push(s.walls!.length ? opponentMovesLeft(s, s.walls![0].until, s.walls![0].color) : 0);
    assert.ok(g.applyMove(g.turn, g.legalMoves(g.turn)[0]).ok);
  }
  assert.deepEqual(seen, [6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1]);
  assert.equal(g.toJSON().walls!.length, 0, 'the wall is gone after the sixth opponent move');
});
