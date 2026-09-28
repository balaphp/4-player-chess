import { Cell, Color, Mode, Piece, PieceType, SIZE } from './types.js';

// 14x14 grid with the 3x3 corners cut off -> cross-shaped playing area
export function inBoard(x: number, y: number): boolean {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return false;
  const edgeX = x < 3 || x > 10;
  const edgeY = y < 3 || y > 10;
  return !(edgeX && edgeY);
}

// duel (1v1) is classic chess on the central 8x8 window
export function inBoardForMode(mode: Mode, x: number, y: number): boolean {
  if (mode === 'duel') return x >= 3 && x <= 10 && y >= 3 && y <= 10;
  return inBoard(x, y);
}

function mk(type: PieceType, color: Color): Piece {
  return { type, color, hasMoved: false, dead: false };
}

const BACK_RANK: PieceType[] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];

// 1v1 setup: red on rank 4, yellow on rank 11, inside the 8x8 window
export function duelBoard(): Cell[][] {
  const board: Cell[][] = Array.from({ length: SIZE }, () => Array<Cell>(SIZE).fill(null));
  for (let i = 0; i < 8; i++) {
    const t = BACK_RANK[i];
    board[3][3 + i] = mk(t, 'red');
    board[4][3 + i] = mk('P', 'red');
    board[10][3 + i] = mk(t, 'yellow');
    board[9][3 + i] = mk('P', 'yellow');
  }
  return board;
}

// 4-player setup; queens face queens across the board
export function initialBoard(): Cell[][] {
  const board: Cell[][] = Array.from({ length: SIZE }, () => Array<Cell>(SIZE).fill(null));
  for (let i = 0; i < 8; i++) {
    const t = BACK_RANK[i];
    // red (bottom)
    board[0][3 + i] = mk(t, 'red');
    board[1][3 + i] = mk('P', 'red');
    // yellow (top)
    board[13][3 + i] = mk(t, 'yellow');
    board[12][3 + i] = mk('P', 'yellow');
    // blue (left)
    board[3 + i][0] = mk(t, 'blue');
    board[3 + i][1] = mk('P', 'blue');
    // green (right)
    board[3 + i][13] = mk(t, 'green');
    board[3 + i][12] = mk('P', 'green');
  }
  return board;
}
