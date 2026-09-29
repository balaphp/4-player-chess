import { duelBoard, inBoardForMode, initialBoard } from './board.js';
import {
  ALL_POWERS,
  AppliedMove,
  canSeePower,
  Cell,
  Color,
  COLORS,
  Elimination,
  EliminationReason,
  FORWARD,
  GameJSON,
  Mode,
  Move,
  Piece,
  PIECE_VALUE,
  PieceType,
  Pos,
  posNameFor,
  DUEL_OFFSET,
  EFFECT_OPPONENT_MOVES,
  PowerAction,
  PowerId,
  POWER_INFO,
  powerInPlay,
  Shield,
  SIZE,
  TEAM_OF,
  Trap,
  viewOf,
  Wall,
} from './types.js';

const ORTHO: Pos[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
const DIAG: Pos[] = [
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];
const KNIGHT: Pos[] = [
  { x: 1, y: 2 },
  { x: 2, y: 1 },
  { x: 2, y: -1 },
  { x: 1, y: -2 },
  { x: -1, y: -2 },
  { x: -2, y: -1 },
  { x: -2, y: 1 },
  { x: -1, y: 2 },
];

const MAX_PLY = 800;

const ELIMINATION_BONUS: Record<EliminationReason, number> = {
  checkmate: 20,
  'king-captured': 20,
  stalemate: 10,
  resigned: 0,
  timeout: 0,
};

const WIN_BONUS = 20;

// power durations in plies (8 plies = two full rounds of four players)

interface UndoRecord {
  cells: { pos: Pos; cell: Cell }[];
}

export interface MovePreview {
  destAttacked: boolean;
  destDefended: boolean;
  checksGiven: Color[];
  eliminationsGiven: Color[]; // enemies left with no legal reply
  testedMobility: Partial<Record<Color, number>>;
}

export class FourChess {
  board: Cell[][];
  mode: Mode;
  turn: Color;
  points: Record<Color, number> = { red: 0, blue: 0, yellow: 0, green: 0 };
  alive: Color[];
  eliminated: Elimination[] = [];
  winners: Color[] | null = null;
  history: AppliedMove[] = [];
  ply = 0;
  powersEnabled: boolean;
  rev = 0;
  powers: Record<Color, PowerId[]>;
  traps: Trap[] = [];
  walls: Wall[] = [];
  shields: Shield[] = [];

  constructor(mode: Mode = 'ffa', powersEnabled = false) {
    this.mode = mode;
    this.board = mode === 'duel' ? duelBoard() : initialBoard();
    this.turn = 'red';
    this.alive = mode === 'duel' ? ['red', 'yellow'] : [...COLORS];
    this.powersEnabled = powersEnabled;
    this.powers = {
      red: powersEnabled ? [...ALL_POWERS] : [],
      blue: powersEnabled ? [...ALL_POWERS] : [],
      yellow: powersEnabled ? [...ALL_POWERS] : [],
      green: powersEnabled ? [...ALL_POWERS] : [],
    };
  }

  // duel games only use the central 8x8 window
  inBounds(x: number, y: number): boolean {
    return inBoardForMode(this.mode, x, y);
  }

  isFrozen(p: Piece): boolean {
    return (p.frozenUntil ?? 0) > this.ply;
  }

  isShieldedAt(x: number, y: number, color: Color): boolean {
    return this.shields.some(s => s.x === x && s.y === y && s.until > this.ply && s.color === color);
  }

  private isHomeSide(color: Color, pos: Pos): boolean {
    const off = this.mode === 'duel' ? DUEL_OFFSET : 0;
    switch (color) {
      case 'red':    return pos.y <= off + 3;
      case 'yellow': return pos.y >= 13 - off - 3;
      case 'blue':   return pos.x <= off + 3;
      case 'green':  return pos.x >= 13 - off - 3;
    }
  }

  // Effects last until the caster's opponents have made 6 moves: with N
  // players in rotation that is ceil(6/(N-1)) full rounds worth of plies.
  private effectPlies(): number {
    const n = Math.max(2, this.alive.length);
    return Math.ceil(EFFECT_OPPONENT_MOVES / (n - 1)) * n;
  }

  wallAt(x: number, y: number): boolean {
    return this.walls.some((w) => w.x === x && w.y === y && w.until > this.ply);
  }

  get status(): 'active' | 'finished' {
    return this.winners ? 'finished' : 'active';
  }

  pieceAt(p: Pos): Cell {
    if (!this.inBounds(p.x, p.y)) return null;
    return this.board[p.y][p.x];
  }

  isEnemy(a: Color, b: Color): boolean {
    return this.mode === 'teams' ? TEAM_OF[a] !== TEAM_OF[b] : a !== b;
  }

  isAlive(c: Color): boolean {
    return this.alive.includes(c);
  }

  kingPos(color: Color): Pos | null {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = this.board[y][x];
        if (p && p.type === 'K' && p.color === color && !p.dead) return { x, y };
      }
    }
    return null;
  }

  isSquareAttacked(pos: Pos, defender: Color): boolean {
    // knights
    for (const d of KNIGHT) {
      const p = this.pieceAt({ x: pos.x + d.x, y: pos.y + d.y });
      if (p && this.canAttack(p) && p.type === 'N' && this.isEnemy(p.color, defender)) return true;
    }
    // rooks, queens, adjacent kings
    for (const d of ORTHO) {
      for (let i = 1; ; i++) {
        const sq = { x: pos.x + d.x * i, y: pos.y + d.y * i };
        if (!this.inBounds(sq.x, sq.y) || this.wallAt(sq.x, sq.y)) break;
        const p = this.board[sq.y][sq.x];
        if (!p) continue;
        if (this.canAttack(p) && this.isEnemy(p.color, defender)) {
          if (p.type === 'R' || p.type === 'Q') return true;
          if (p.type === 'K' && i === 1) return true;
        }
        break; // dead/frozen pieces don't attack but still block
      }
    }
    // bishops, queens, adjacent kings, pawns
    for (const d of DIAG) {
      for (let i = 1; ; i++) {
        const sq = { x: pos.x + d.x * i, y: pos.y + d.y * i };
        if (!this.inBounds(sq.x, sq.y) || this.wallAt(sq.x, sq.y)) break;
        const p = this.board[sq.y][sq.x];
        if (!p) continue;
        if (this.canAttack(p) && this.isEnemy(p.color, defender)) {
          if (p.type === 'B' || p.type === 'Q') return true;
          if (p.type === 'K' && i === 1) return true;
          if (p.type === 'P' && i === 1) {
            const f = FORWARD[p.color];
            const perp = { x: f.y, y: f.x };
            const dx = pos.x - sq.x;
            const dy = pos.y - sq.y;
            if (
              (dx === f.x + perp.x && dy === f.y + perp.y) ||
              (dx === f.x - perp.x && dy === f.y - perp.y)
            ) {
              return true;
            }
          }
        }
        break;
      }
    }
    return false;
  }

  inCheck(color: Color): boolean {
    const k = this.kingPos(color);
    if (!k) return false;
    const king = this.board[k.y][k.x]!;
    if (this.isFrozen(king) || this.isShieldedAt(k.x, k.y, king.color)) return false; // uncapturable, so no check
    return this.isSquareAttacked(k, color);
  }

  // dead enemy pieces are capturable obstacles; frozen/shielded ones are off limits
  private canCapture(mover: Color, target: Piece, tx: number, ty: number): boolean {
    if (this.isFrozen(target) || this.isShieldedAt(tx, ty, target.color)) return false;
    return this.mode === 'teams' ? TEAM_OF[target.color] !== TEAM_OF[mover] : target.color !== mover;
  }

  private canAttack(p: Piece): boolean {
    return !p.dead && !this.isFrozen(p);
  }

  private pseudoMoves(color: Color): Move[] {
    const moves: Move[] = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = this.board[y][x];
        if (!p || p.dead || p.color !== color || this.isFrozen(p)) continue;
        const from = { x, y };
        switch (p.type) {
          case 'P':
            this.pawnMoves(from, p, moves);
            break;
          case 'N':
            for (const d of KNIGHT) this.stepMove(from, p, d, moves);
            break;
          case 'B':
            for (const d of DIAG) this.rayMoves(from, p, d, moves);
            break;
          case 'R':
            for (const d of ORTHO) this.rayMoves(from, p, d, moves);
            break;
          case 'Q':
            for (const d of [...ORTHO, ...DIAG]) this.rayMoves(from, p, d, moves);
            break;
          case 'K':
            for (const d of [...ORTHO, ...DIAG]) this.stepMove(from, p, d, moves);
            this.castleMoves(from, p, moves);
            break;
        }
      }
    }
    return moves;
  }

  // A pawn promotes on the last square of its file: the opposite edge of the
  // board in 4-player games, the 8th rank of the window in a duel.
  private isPromotionSquare(color: Color, to: Pos): boolean {
    const f = FORWARD[color];
    return !this.inBounds(to.x + f.x, to.y + f.y);
  }

  private pushPawnMove(from: Pos, to: Pos, color: Color, moves: Move[]) {
    if (this.isPromotionSquare(color, to)) {
      moves.push({ from, to, promotion: 'Q' });
    } else {
      moves.push({ from, to });
    }
  }

  private pawnMoves(from: Pos, p: Piece, moves: Move[]) {
    const f = FORWARD[p.color];
    const one = { x: from.x + f.x, y: from.y + f.y };
    if (this.inBounds(one.x, one.y) && !this.board[one.y][one.x] && !this.wallAt(one.x, one.y)) {
      this.pushPawnMove(from, one, p.color, moves);
      const two = { x: from.x + 2 * f.x, y: from.y + 2 * f.y };
      if (!p.hasMoved && this.inBounds(two.x, two.y) && !this.board[two.y][two.x] && !this.wallAt(two.x, two.y)) {
        moves.push({ from, to: two });
      }
    }
    const perp = { x: f.y, y: f.x };
    for (const s of [1, -1]) {
      const to = { x: from.x + f.x + s * perp.x, y: from.y + f.y + s * perp.y };
      if (!this.inBounds(to.x, to.y)) continue;
      const target = this.board[to.y][to.x];
      if (target && this.canCapture(p.color, target, to.x, to.y)) {
        this.pushPawnMove(from, to, p.color, moves);
      }
    }
  }

  private stepMove(from: Pos, p: Piece, d: Pos, moves: Move[]) {
    const to = { x: from.x + d.x, y: from.y + d.y };
    if (!this.inBounds(to.x, to.y) || this.wallAt(to.x, to.y)) return;
    const target = this.board[to.y][to.x];
    if (!target || this.canCapture(p.color, target, to.x, to.y)) moves.push({ from, to });
  }

  private rayMoves(from: Pos, p: Piece, d: Pos, moves: Move[]) {
    for (let i = 1; ; i++) {
      const to = { x: from.x + d.x * i, y: from.y + d.y * i };
      if (!this.inBounds(to.x, to.y) || this.wallAt(to.x, to.y)) break;
      const target = this.board[to.y][to.x];
      if (!target) {
        moves.push({ from, to });
        continue;
      }
      if (this.canCapture(p.color, target, to.x, to.y)) moves.push({ from, to });
      break;
    }
  }

  private castleMoves(from: Pos, king: Piece, moves: Move[]) {
    if (king.hasMoved) return;
    if (this.isSquareAttacked(from, king.color)) return;
    const axis: Pos[] =
      king.color === 'red' || king.color === 'yellow'
        ? [{ x: 1, y: 0 }, { x: -1, y: 0 }]
        : [{ x: 0, y: 1 }, { x: 0, y: -1 }];
    for (const d of axis) {
      let rook: { piece: Piece; pos: Pos } | null = null;
      for (let i = 1; ; i++) {
        const sq = { x: from.x + d.x * i, y: from.y + d.y * i };
        // a wall between king and rook stops the castle
        if (!this.inBounds(sq.x, sq.y) || this.wallAt(sq.x, sq.y)) break;
        const p = this.board[sq.y][sq.x];
        if (!p) continue;
        if (p.type === 'R' && p.color === king.color && !p.hasMoved && !p.dead) {
          rook = { piece: p, pos: sq };
        }
        break;
      }
      if (!rook) continue;
      // both squares the king crosses must be empty and unattacked
      const s1 = { x: from.x + d.x, y: from.y + d.y };
      const s2 = { x: from.x + 2 * d.x, y: from.y + 2 * d.y };
      if (this.board[s1.y][s1.x] || this.board[s2.y][s2.x]) continue;
      if (this.isSquareAttacked(s1, king.color) || this.isSquareAttacked(s2, king.color)) continue;
      const dist = Math.abs(rook.pos.x - from.x) + Math.abs(rook.pos.y - from.y);
      moves.push({ from, to: s2, castle: dist > 3 ? 'queen' : 'king' });
    }
  }

  private make(move: Move): UndoRecord {
    const snap = (pos: Pos): { pos: Pos; cell: Cell } => {
      const c = this.board[pos.y][pos.x];
      return { pos: { ...pos }, cell: c ? { ...c } : null };
    };
    const undo: UndoRecord = { cells: [snap(move.from), snap(move.to)] };
    const piece = this.board[move.from.y][move.from.x]!;
    this.board[move.from.y][move.from.x] = null;
    this.board[move.to.y][move.to.x] = {
      ...piece,
      hasMoved: true,
      type: move.promotion ?? piece.type,
    };
    if (move.castle) {
      const d = {
        x: Math.sign(move.to.x - move.from.x),
        y: Math.sign(move.to.y - move.from.y),
      };
      // the rook sits beyond the king's landing square, hence i = 3
      for (let i = 3; ; i++) {
        const sq = { x: move.from.x + d.x * i, y: move.from.y + d.y * i };
        if (!this.inBounds(sq.x, sq.y)) break;
        const p = this.board[sq.y][sq.x];
        if (!p) continue;
        if (p.type === 'R' && p.color === piece.color) {
          const rookTo = { x: move.from.x + d.x, y: move.from.y + d.y };
          undo.cells.push(snap(sq), snap(rookTo));
          this.board[sq.y][sq.x] = null;
          this.board[rookTo.y][rookTo.x] = { ...p, hasMoved: true };
        }
        break;
      }
    }
    return undo;
  }

  private unmake(undo: UndoRecord) {
    // reverse order: castle snapshots can overlap
    for (let i = undo.cells.length - 1; i >= 0; i--) {
      const { pos, cell } = undo.cells[i];
      this.board[pos.y][pos.x] = cell ? { ...cell } : null;
    }
  }

  legalMoves(color: Color): Move[] {
    if (!this.isAlive(color)) return [];
    const out: Move[] = [];
    for (const m of this.pseudoMoves(color)) {
      const undo = this.make(m);
      if (!this.inCheck(color)) out.push(m);
      this.unmake(undo);
    }
    return out;
  }

  legalMovesFrom(color: Color, from: Pos): Move[] {
    return this.legalMoves(color).filter((m) => m.from.x === from.x && m.from.y === from.y);
  }

  // make/score/unmake helper for the AI
  previewMove(color: Color, move: Move): MovePreview {
    const undo = this.make(move);
    const destAttacked = this.isSquareAttacked(move.to, color);
    // "defended" = could we recapture there? probe with a dummy enemy pawn
    const occupant = this.board[move.to.y][move.to.x]!;
    let destDefended = false;
    for (const enemy of this.alive) {
      if (!this.isEnemy(enemy, color)) continue;
      this.board[move.to.y][move.to.x] = { type: 'P', color: enemy, hasMoved: true, dead: false };
      if (this.isSquareAttacked(move.to, enemy)) destDefended = true;
      this.board[move.to.y][move.to.x] = occupant;
      break;
    }
    const enemies = this.alive.filter((c) => this.isEnemy(c, color));
    const checksGiven = enemies.filter((c) => this.inCheck(c));
    // mate detection is only worth the cost for checked or nearly-bare enemies
    const toTest = new Set<Color>(checksGiven);
    for (const c of enemies) {
      if (this.countPieces(c) <= 3) toTest.add(c);
    }
    const testedMobility: Partial<Record<Color, number>> = {};
    const eliminationsGiven: Color[] = [];
    for (const c of toTest) {
      const n = this.legalMoves(c).length;
      testedMobility[c] = n;
      if (n === 0) eliminationsGiven.push(c);
    }
    this.unmake(undo);
    return { destAttacked, destDefended, checksGiven, eliminationsGiven, testedMobility };
  }

  countPieces(color: Color): number {
    let n = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = this.board[y][x];
        if (p && p.color === color && !p.dead) n++;
      }
    }
    return n;
  }

  // Elimination by an enemy's move pays them the bonus and hands over the dead
  // player's army (conquest). Resignations just leave grey obstacles behind.
  private eliminate(color: Color, reason: EliminationReason, eliminator: Color | null = null) {
    if (!this.isAlive(color)) return;
    this.alive = this.alive.filter((c) => c !== color);
    this.eliminated.push({ color, reason });
    const conquest = eliminator !== null && eliminator !== color && ELIMINATION_BONUS[reason] > 0;
    if (conquest) this.points[eliminator!] += ELIMINATION_BONUS[reason];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = this.board[y][x];
        if (!p || p.color !== color) continue;
        if (conquest) {
          // converted pieces lose double-step/castling rights
          this.board[y][x] =
            p.type === 'K' ? null : { type: p.type, color: eliminator!, hasMoved: true, dead: false };
        } else {
          p.dead = true;
        }
      }
    }
  }

  private declareWinners(winners: Color[]) {
    this.winners = [...winners];
    for (const w of this.winners) this.points[w] += WIN_BONUS;
  }

  private checkWinners() {
    if (this.winners) return;
    if (this.mode === 'teams') {
      const teams = new Set(this.alive.map((c) => TEAM_OF[c]));
      if (teams.size === 1) {
        const t = [...teams][0];
        this.declareWinners(COLORS.filter((c) => TEAM_OF[c] === t));
      }
    } else {
      // ffa and duel: last player standing wins
      if (this.alive.length === 1) this.declareWinners([this.alive[0]]);
    }
    if (!this.winners && this.alive.length === 0) this.winners = [];
  }

  private nextAliveAfter(color: Color): Color {
    const start = COLORS.indexOf(color);
    for (let i = 1; i <= 4; i++) {
      const c = COLORS[(start + i) % 4];
      if (this.isAlive(c)) return c;
    }
    return color;
  }

  // A piece just landed on pos — fire the traps there. Traps only ever affect
  // their owner's enemies; several may share a square, and they go off in
  // placement order until one removes the piece (the rest stay armed).
  // Returns the traps that went off: from then on they are no secret.
  private triggerTrapAt(pos: Pos): Trap['type'][] {
    const sprung: Trap['type'][] = [];
    if (!this.inBounds(pos.x, pos.y)) return sprung;
    for (const trap of this.traps.filter((t) => t.x === pos.x && t.y === pos.y)) {
      const piece = this.board[pos.y][pos.x];
      if (!piece || piece.dead) break;
      if (!this.isEnemy(piece.color, trap.color)) continue;
      this.traps.splice(this.traps.indexOf(trap), 1);
      sprung.push(trap.type);
      if (trap.type === 'faint') {
        piece.frozenUntil = this.ply + this.alive.length + 1;
        continue;
      }
      if (trap.type === 'teleport') {
        const empty: Pos[] = [];
        for (let ey = 0; ey < SIZE; ey++) {
          for (let ex = 0; ex < SIZE; ex++) {
            if (!this.inBounds(ex, ey)) continue;
            if (ex === pos.x && ey === pos.y) continue;
            if (this.board[ey][ex] || this.wallAt(ex, ey)) continue;
            empty.push({ x: ex, y: ey });
          }
        }
        if (empty.length > 0) {
          const dest = empty[Math.floor(Math.random() * empty.length)];
          this.board[dest.y][dest.x] = piece;
          this.board[pos.y][pos.x] = null;
        }
        continue;
      }
      const wasLivingKing = piece.type === 'K' && this.isAlive(piece.color);
      this.board[pos.y][pos.x] = null; // mine kills score nothing
      if (wasLivingKing) {
        this.eliminate(piece.color, 'king-captured', trap.color);
        this.checkWinners();
      }
    }
    return sprung;
  }

  // Advance to the next living player, eliminating anyone found without a
  // legal move on the way (checkmate if in check, stalemate otherwise).
  private advanceTurn() {
    if (this.winners) return;
    this.walls = this.walls.filter((w) => w.until > this.ply);
    this.shields = this.shields.filter((s) => s.until > this.ply);
    this.traps = this.traps.filter((t) => (t.expires ?? Number.MAX_SAFE_INTEGER) > this.ply);
    if (this.ply >= MAX_PLY) {
      // hard move limit: highest points wins
      const top = Math.max(...this.alive.map((c) => this.points[c]));
      this.declareWinners(this.alive.filter((c) => this.points[c] === top));
      return;
    }
    this.settleTurn(this.nextAliveAfter(this.turn));
  }

  // Give the move to `start`, eliminating anyone found without a legal reply
  // along the way (checkmate if in check, stalemate otherwise).
  private settleTurn(start: Color) {
    let next = start;
    for (let guard = 0; guard < 4; guard++) {
      this.turn = next;
      if (this.winners) return;
      if (this.legalMoves(next).length > 0) return;
      // last actor gets the credit (and the army)
      const lastActor = this.history.length > 0 ? this.history[this.history.length - 1].color : null;
      const eliminator = lastActor !== next ? lastActor : null;
      this.eliminate(next, this.inCheck(next) ? 'checkmate' : 'stalemate', eliminator);
      this.checkWinners();
      if (this.winners) return;
      next = this.nextAliveAfter(next);
    }
  }

  private sq(p: Pos): string {
    return posNameFor(this.mode, p);
  }

  applyMove(color: Color, move: Move): { ok: true; applied: AppliedMove } | { ok: false; error: string } {
    if (this.winners) return { ok: false, error: 'Game is over' };
    if (color !== this.turn) return { ok: false, error: `It is ${this.turn}'s turn` };
    const legal = this.legalMoves(color).find(
      (m) => m.from.x === move.from.x && m.from.y === move.from.y && m.to.x === move.to.x && m.to.y === move.to.y,
    );
    if (!legal) return { ok: false, error: 'Illegal move' };
    if (legal.promotion) {
      const req = move.promotion;
      legal.promotion = req === 'N' || req === 'B' || req === 'R' || req === 'Q' ? req : 'Q';
    }

    const piece = this.board[move.from.y][move.from.x]!;
    const target = this.board[move.to.y][move.to.x];
    const captured = target ? { type: target.type, color: target.color } : null;
    const capturedLivingKing = target && target.type === 'K' && !target.dead && this.isAlive(target.color);

    this.make(legal);
    const initial = color[0].toUpperCase();
    const notation = legal.castle
      ? `${initial}: ${legal.castle === 'king' ? 'O-O' : 'O-O-O'}`
      : `${initial}: ${piece.type === 'P' ? '' : piece.type}${this.sq(legal.from)}${captured ? 'x' : '-'}${this.sq(legal.to)}${legal.promotion ? '=' + legal.promotion : ''}`;
    const applied: AppliedMove = { ...legal, color, piece: piece.type, captured, notation };
    this.history.push(applied);
    this.ply++;
    this.rev++;

    // kings score via the elimination bonus, not here
    if (captured && target && !target.dead && target.type !== 'K') {
      this.points[color] += PIECE_VALUE[captured.type];
    }
    if (capturedLivingKing) {
      this.eliminate(target!.color, 'king-captured', color);
      this.checkWinners();
    }
    const sprung = this.triggerTrapAt(legal.to);
    if (sprung.length > 0) {
      applied.sprung = sprung;
      applied.notation += sprung.map((type) => ` ${POWER_INFO[type].icon}`).join('');
    }
    this.advanceTurn();
    return { ok: true, applied };
  }

  // ---------- secret powers ----------

  canSee(viewer: Color | null, power: { color?: Color; knownTo?: Color[] }): boolean {
    return canSeePower(this.mode, viewer, power);
  }

  private hiddenWallsFor(color: Color): Wall[] {
    return this.walls.filter((w) => w.until > this.ply && !this.canSee(color, w));
  }

  // the board as `color` knows it: without the walls they cannot see
  private asSeenBy(color: Color): FourChess {
    const seen = this.clone();
    seen.walls = seen.walls.filter((w) => seen.canSee(color, w));
    return seen;
  }

  // A move that looked legal to `color` was refused. If a wall they could
  // not see was in the way, that wall is known to them from now on: returns
  // it, or null when the move was simply illegal.
  revealWall(color: Color, move: Move): Wall | null {
    if (this.winners || color !== this.turn) return null;
    const hidden = this.hiddenWallsFor(color);
    if (hidden.length === 0) return null;
    const isTheMove = (m: Move) =>
      m.from.x === move.from.x && m.from.y === move.from.y && m.to.x === move.to.x && m.to.y === move.to.y;
    const seen = this.asSeenBy(color);
    if (!seen.legalMoves(color).some(isTheMove)) return null;
    // the walls that stop the move, nearest to the piece first: that is the one it runs into
    const distance = (w: Wall) => Math.max(Math.abs(w.x - move.from.x), Math.abs(w.y - move.from.y));
    const inTheWay = hidden
      .filter((w) => {
        seen.walls.push(w);
        const stopped = !seen.legalMoves(color).some(isTheMove);
        seen.walls.pop();
        return stopped;
      })
      .sort((a, b) => distance(a) - distance(b));
    const wall = inTheWay[0];
    if (!wall) return null;
    wall.knownTo = [...(wall.knownTo ?? []), color];
    this.rev++;
    return wall;
  }

  // Legal moves that do not look legal to `color`, because a wall they cannot
  // see stands between an attacker and their king. Their own board cannot
  // work these out, so they have to be told.
  unseenLegalMoves(color: Color): Move[] {
    if (this.winners || color !== this.turn) return [];
    if (this.hiddenWallsFor(color).length === 0) return [];
    const key = (m: Move) => `${m.from.x},${m.from.y},${m.to.x},${m.to.y}`;
    const seen = new Set(this.asSeenBy(color).legalMoves(color).map(key));
    return this.legalMoves(color).filter((m) => !seen.has(key(m)));
  }

  // powers are single-use, set on your own turn before the move, one at a time
  applyPower(color: Color, action: PowerAction): { ok: true; applied: AppliedMove } | { ok: false; error: string } {
    const err = (error: string) => ({ ok: false as const, error });
    if (this.winners) return err('Game is over');
    if (!this.powersEnabled) return err('Powers are not enabled in this game');
    if (color !== this.turn) return err(`It is ${this.turn}'s turn`);
    if (!this.powers[color].includes(action.power)) return err('You have already used that power');
    const inPlay = powerInPlay(this, color);
    if (inPlay) return err(`One power at a time: your ${POWER_INFO[inPlay].name} is still in play`);
    const initial = color[0].toUpperCase();
    const icon = POWER_INFO[action.power].icon;
    const HIDDEN: Pos = { x: -1, y: -1 };
    let notation = '';
    let from = HIDDEN;
    let to = HIDDEN;
    let captured: AppliedMove['captured'] = null;

    // One square holds one power, as far as the player can tell: a shield
    // (everyone sees those), or a wall or trap they know of. Enemy walls and
    // traps are secret and never checked here, or the refusal would give
    // them away: powers may unknowingly share a square.
    const hasPower = (t: Pos) =>
      this.shields.some((s) => s.x === t.x && s.y === t.y && s.until > this.ply) ||
      this.walls.some((w) => w.x === t.x && w.y === t.y && w.until > this.ply && this.canSee(color, w)) ||
      this.traps.some((tr) => tr.x === t.x && tr.y === t.y && this.canSee(color, tr));
    const placeError = (t: Pos): string | null => {
      if (!this.inBounds(t.x, t.y) || this.board[t.y][t.x]) return 'Pick an empty square';
      if (hasPower(t)) return 'That square already has a power';
      return null;
    };

    switch (action.power) {
      case 'faint':
      case 'mine':
      case 'teleport': {
        const problem = placeError(action.target);
        if (problem) return err(problem);
        this.traps.push({ type: action.power, color, x: action.target.x, y: action.target.y, expires: this.ply + this.effectPlies() });
        notation = `${initial}: ${icon} set a ${action.power === 'teleport' ? 'teleport' : 'secret'} trap`;
        break;
      }
      case 'wall': {
        const problem = placeError(action.target);
        if (problem) return err(problem);
        this.walls.push({ x: action.target.x, y: action.target.y, until: this.ply + this.effectPlies(), color });
        if (this.legalMoves(color).length === 0) {
          this.walls.pop();
          return err('That wall would leave you without a legal move');
        }
        notation = `${initial}: 🧱 ${this.sq(action.target)}`;
        from = to = action.target;
        break;
      }
      case 'shield': {
        if (!this.inBounds(action.target.x, action.target.y)) return err('Pick a square on the board');
        if (!this.isHomeSide(color, action.target)) return err('Shield can only protect your home rows');
        if (hasPower(action.target)) return err('That square already has a power');
        this.shields.push({ x: action.target.x, y: action.target.y, until: this.ply + this.effectPlies(), color });
        notation = `${initial}: 🛡 ${this.sq(action.target)}`;
        from = to = action.target;
        break;
      }
    }

    this.powers[color] = this.powers[color].filter((pw) => pw !== action.power);
    const applied: AppliedMove = { from, to, color, piece: 'P', captured, notation, power: action.power };
    this.history.push(applied);
    this.rev++;
    // powers are free actions taken before the move: the turn stays put
    return { ok: true, applied };
  }

  resign(color: Color, reason: EliminationReason = 'resigned') {
    if (this.winners || !this.isAlive(color)) return;
    const wasTheirTurn = this.turn === color;
    this.eliminate(color, reason, null);
    this.rev++;
    this.checkWinners();
    if (this.winners) return;
    if (wasTheirTurn) this.advanceTurn();
  }

  toJSON(): GameJSON {
    const pieces: GameJSON['pieces'] = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = this.board[y][x];
        if (p) {
          pieces.push({
            x,
            y,
            type: p.type,
            color: p.color,
            dead: p.dead,
            hasMoved: p.hasMoved,
            ...(p.frozenUntil ? { frozenUntil: p.frozenUntil } : {}),
          });
        }
      }
    }
    return {
      mode: this.mode,
      pieces,
      points: { ...this.points },
      powersEnabled: this.powersEnabled,
      powers: {
        red: [...this.powers.red],
        blue: [...this.powers.blue],
        yellow: [...this.powers.yellow],
        green: [...this.powers.green],
      },
      walls: this.walls.filter((w) => w.until > this.ply).map((w) => ({ ...w })),
      shields: this.shields.filter((s) => s.until > this.ply).map((s) => ({ ...s })),
      traps: this.traps.map((t) => ({ ...t })),
      turn: this.turn,
      alive: [...this.alive],
      eliminated: [...this.eliminated],
      inCheck: this.alive.filter((c) => this.inCheck(c)),
      winners: this.winners ? [...this.winners] : null,
      history: [...this.history],
      lastMove: [...this.history].reverse().find((h) => !h.power) ?? null,
      rev: this.rev,
      ply: this.ply,
    };
  }

  // what a client may be sent: see viewOf
  toClientJSON(viewer: Color | null): GameJSON {
    return viewOf(this.toJSON(), viewer);
  }

  static fromJSON(json: GameJSON): FourChess {
    const g = new FourChess(json.mode, json.powersEnabled ?? false);
    g.rev = json.rev ?? 0;
    g.board = Array.from({ length: SIZE }, () => Array<Cell>(SIZE).fill(null));
    for (const p of json.pieces) {
      g.board[p.y][p.x] = {
        type: p.type,
        color: p.color,
        hasMoved: p.hasMoved,
        dead: p.dead,
        ...(p.frozenUntil ? { frozenUntil: p.frozenUntil } : {}),
      };
    }
    if (json.powers) {
      g.powers = {
        red: [...json.powers.red],
        blue: [...json.powers.blue],
        yellow: [...json.powers.yellow],
        green: [...json.powers.green],
      };
    }
    g.walls = (json.walls ?? []).map((w) => ({ ...w }));
    g.shields = (json.shields ?? []).map((s) => ({ ...s }));
    g.traps = (json.traps ?? []).map((t) => ({ ...t }));
    g.turn = json.turn;
    g.points = json.points ? { ...json.points } : { red: 0, blue: 0, yellow: 0, green: 0 };
    g.alive = [...json.alive];
    g.eliminated = [...json.eliminated];
    g.winners = json.winners ? [...json.winners] : null;
    g.history = [...json.history];
    g.ply = json.ply;
    return g;
  }

  clone(): FourChess {
    return FourChess.fromJSON(this.toJSON());
  }
}
