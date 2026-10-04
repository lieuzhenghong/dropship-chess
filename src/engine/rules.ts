// Dropship Chess rules engine.
//
// Ported from Board.jack in lieuzhenghong/nand2tetris-dropship-chess. The game
// is chess on a 6x6 board where captured pieces change sides and can be
// "dropped" back onto any empty square by the capturer, using up their turn.
//
// Faithful to the original:
//   - Pawns move one square forward, capture one square diagonally forward.
//     No double step, no en passant. No castling.
//   - No check/checkmate: you win by capturing the opponent's King, and
//     nothing stops a King walking into check. (Added here: a player with no
//     legal move loses, so a game can't get stuck.)
//   - Drops go onto any empty square and use your turn.
// Changes from the original:
//   - Starting position: the original gave White two knights and Black two
//     bishops. Here both sides get R, R, Q, K, N, B, with the back rank
//     shuffled each game (Fischer random style) and Black's mirroring White's,
//     so the only asymmetry is who moves first.
//   - Sliding pieces no longer wrap around the board edges (a bug in the Jack
//     version, which worked on raw square indices).
//   - Pawns reaching the last rank promote to a Queen (the original listed
//     "no pawn promotion" as a limitation, which left pawns stuck forever).
//     As in crazyhouse, a promoted piece turns back into a pawn when captured.
//   - Pawns can't be dropped into the opponent's starting rows, i.e. their
//     back two ranks (the original had a TODO to forbid the last rank). A
//     pawn dropped one step from promotion proved too strong in play.
//
// Squares are indexed 0..35, row-major, with index 0 at the top-left (Black's
// back rank, as in the original). White moves "up" (decreasing row).

export const SIZE = 6;
export const SQUARES = SIZE * SIZE;

export type Colour = 'w' | 'b';
export type Kind = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';
/** Kinds that can sit in a hand. Kings are never captured into a hand. */
export type HandKind = Exclude<Kind, 'K'>;
export const HAND_KINDS: readonly HandKind[] = ['P', 'N', 'B', 'R', 'Q'];

export interface Piece {
  readonly colour: Colour;
  readonly kind: Kind;
  /** True for a Queen that started life as a pawn. */
  readonly promoted?: boolean;
}

export type Hand = Readonly<Record<HandKind, number>>;

export type Move =
  | { readonly type: 'move'; readonly from: number; readonly to: number }
  | { readonly type: 'drop'; readonly kind: HandKind; readonly to: number };

export interface GameState {
  readonly board: readonly (Piece | null)[];
  readonly hands: Readonly<Record<Colour, Hand>>;
  readonly turn: Colour;
  readonly winner: Colour | null;
  /** How the game was won: the King was captured, or the loser had no legal move. */
  readonly winBy?: 'king' | 'stuck';
  readonly lastMove: Move | null;
}

export const other = (c: Colour): Colour => (c === 'w' ? 'b' : 'w');
export const row = (sq: number): number => Math.floor(sq / SIZE);
export const col = (sq: number): number => sq % SIZE;
export const square = (r: number, c: number): number => r * SIZE + c;
const onBoard = (r: number, c: number): boolean => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

const emptyHand = (): Hand => ({ P: 0, N: 0, B: 0, R: 0, Q: 0 });

/** A fixed back rank, used when none is given (e.g. in tests). */
export const DEFAULT_BACK_RANK: readonly Kind[] = ['R', 'N', 'Q', 'K', 'B', 'R'];
const BACK_RANK_PIECES: readonly Kind[] = ['R', 'R', 'Q', 'K', 'N', 'B'];

/**
 * Back ranks never dealt, because they hand White a near-forced win: a
 * Fairy-Stockfish evaluation of the starting position of +1.00 or more for
 * White (scripts/fairy/eval-starts.ts regenerates the list). Nearly all have
 * the knight two files from the King, so White's knight can raid the enemy
 * King a move before Black's can; the worst won 30 of 30 engine games.
 */
export const EXCLUDED_BACK_RANKS: ReadonlySet<string> = new Set([
  'BKRNRQ', 'BKRQRN', 'BNRKRQ', 'BQKRNR', 'BQRKRN', 'BQRNRK', 'BRKQRN', 'BRNRKQ', 'BRQKRN',
  'KBRQRN', 'KRNRBQ', 'KRNRQB', 'NRKBQR', 'NRKBRQ', 'NRKQBR', 'NRKQRB', 'NRKRBQ', 'NRKRQB',
  'NRQKBR', 'NRQKRB', 'NRQRBK', 'NRQRKB', 'QBKRNR', 'QBRKRN', 'QBRNRK', 'QKRNRB', 'QRBKRN',
  'QRNRBK', 'QRNRKB', 'RBKQRN', 'RBQKRN', 'RNRBKQ', 'RNRKBQ', 'RNRKQB', 'RNRQBK', 'RQBKRN',
]);

/**
 * A random arrangement of R, R, Q, K, N, B. With one bishop each and no
 * castling, none of chess960's placement rules are needed; of the 360
 * distinct arrangements, all but EXCLUDED_BACK_RANKS are dealt.
 */
export function randomBackRank(rng: () => number = Math.random): Kind[] {
  for (;;) {
    const rank = [...BACK_RANK_PIECES];
    for (let i = rank.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [rank[i], rank[j]] = [rank[j], rank[i]];
    }
    if (!EXCLUDED_BACK_RANKS.has(rank.join(''))) return rank;
  }
}

/** The starting position for `backRank` (files a–f), mirrored for Black. */
export function initialState(backRank: readonly Kind[] = DEFAULT_BACK_RANK): GameState {
  const board: (Piece | null)[] = new Array(SQUARES).fill(null);
  backRank.forEach((kind, c) => {
    board[square(0, c)] = { colour: 'b', kind };
    board[square(5, c)] = { colour: 'w', kind };
  });
  for (let c = 0; c < SIZE; c++) {
    board[square(1, c)] = { colour: 'b', kind: 'P' };
    board[square(4, c)] = { colour: 'w', kind: 'P' };
  }
  return {
    board,
    hands: { w: emptyHand(), b: emptyHand() },
    turn: 'w',
    winner: null,
    lastMove: null,
  };
}

/** Row direction a colour's pawns travel in. */
const forward = (c: Colour): number => (c === 'w' ? -1 : 1);
/** The row on which a colour's pawns promote. */
export const lastRank = (c: Colour): number => (c === 'w' ? 0 : SIZE - 1);
/** Whether a pawn of `c` may be dropped on `r`: not into the opponent's starting rows. */
const pawnDropAllowed = (c: Colour, r: number): boolean => (c === 'w' ? r >= 2 : r <= SIZE - 3);

const KNIGHT: readonly [number, number][] = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
];
const ORTHO: readonly [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG: readonly [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ALL = [...ORTHO, ...DIAG];

/**
 * Squares the piece on `from` could move to, ignoring whose turn it is.
 * Includes squares holding an enemy piece (captures), including the enemy King.
 */
export function pieceTargets(board: GameState['board'], from: number): number[] {
  const piece = board[from];
  if (!piece) return [];
  const r0 = row(from);
  const c0 = col(from);
  const out: number[] = [];

  const tryStep = (dr: number, dc: number) => {
    const r = r0 + dr;
    const c = c0 + dc;
    if (!onBoard(r, c)) return;
    const target = board[square(r, c)];
    if (!target || target.colour !== piece.colour) out.push(square(r, c));
  };
  const slide = (dirs: readonly [number, number][]) => {
    for (const [dr, dc] of dirs) {
      let r = r0 + dr;
      let c = c0 + dc;
      while (onBoard(r, c)) {
        const target = board[square(r, c)];
        if (!target) {
          out.push(square(r, c));
        } else {
          if (target.colour !== piece.colour) out.push(square(r, c));
          break;
        }
        r += dr;
        c += dc;
      }
    }
  };

  switch (piece.kind) {
    case 'P': {
      const dr = forward(piece.colour);
      const r = r0 + dr;
      if (!onBoard(r, c0)) break;
      if (!board[square(r, c0)]) out.push(square(r, c0));
      for (const dc of [-1, 1]) {
        if (!onBoard(r, c0 + dc)) continue;
        const target = board[square(r, c0 + dc)];
        if (target && target.colour !== piece.colour) out.push(square(r, c0 + dc));
      }
      break;
    }
    case 'N':
      KNIGHT.forEach(([dr, dc]) => tryStep(dr, dc));
      break;
    case 'K':
      ALL.forEach(([dr, dc]) => tryStep(dr, dc));
      break;
    case 'B':
      slide(DIAG);
      break;
    case 'R':
      slide(ORTHO);
      break;
    case 'Q':
      slide(ALL);
      break;
  }
  return out;
}

/** Empty squares the side to move may drop a piece of `kind` onto. */
export function dropTargets(state: GameState, kind: HandKind): number[] {
  if (state.winner || !(state.hands[state.turn][kind] > 0)) return [];
  const out: number[] = [];
  for (let sq = 0; sq < SQUARES; sq++) {
    if (state.board[sq]) continue;
    if (kind === 'P' && !pawnDropAllowed(state.turn, row(sq))) continue;
    out.push(sq);
  }
  return out;
}

/** Legal destination squares for the side to move's piece on `from`. */
export function moveTargets(state: GameState, from: number): number[] {
  if (state.winner) return [];
  const piece = state.board[from];
  if (!piece || piece.colour !== state.turn) return [];
  return pieceTargets(state.board, from);
}

const isSquare = (x: unknown): x is number =>
  Number.isInteger(x) && (x as number) >= 0 && (x as number) < SQUARES;

/** Checks that untrusted input (e.g. from the network) is a well-formed Move. */
export function isMoveShape(m: unknown): m is Move {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  if (o.type === 'move') return isSquare(o.from) && isSquare(o.to);
  if (o.type === 'drop') return HAND_KINDS.includes(o.kind as HandKind) && isSquare(o.to);
  return false;
}

export function isLegal(state: GameState, move: Move): boolean {
  if (!isMoveShape(move)) return false;
  const targets =
    move.type === 'move' ? moveTargets(state, move.from) : dropTargets(state, move.kind);
  return targets.includes(move.to);
}

/** Returns the new state. Throws on an illegal move. */
export function applyMove(state: GameState, move: Move): GameState {
  if (!isLegal(state, move)) throw new Error(`illegal move: ${JSON.stringify(move)}`);
  const board = state.board.slice();
  const mover = state.turn;
  const hands = { w: { ...state.hands.w }, b: { ...state.hands.b } };
  let winner: Colour | null = null;

  if (move.type === 'drop') {
    board[move.to] = { colour: mover, kind: move.kind };
    hands[mover][move.kind] -= 1;
  } else {
    const piece = board[move.from]!;
    const captured = board[move.to];
    if (captured) {
      if (captured.kind === 'K') {
        winner = mover;
      } else {
        hands[mover][captured.promoted ? 'P' : captured.kind] += 1;
      }
    }
    board[move.from] = null;
    board[move.to] =
      piece.kind === 'P' && row(move.to) === lastRank(mover)
        ? { colour: mover, kind: 'Q', promoted: true }
        : piece;
  }

  if (winner) return { board, hands, turn: mover, winner, winBy: 'king', lastMove: move };
  const next: GameState = { board, hands, turn: other(mover), winner: null, lastMove: move };
  // A player who can't move loses.
  return hasLegalMove(next) ? next : { ...next, turn: mover, winner: mover, winBy: 'stuck' };
}

/**
 * Whether the side to move has any legal move. Stops at the first one found,
 * since this runs after every move (including inside the AI's search).
 */
export function hasLegalMove(state: GameState): boolean {
  for (let sq = 0; sq < SQUARES; sq++) {
    const p = state.board[sq];
    if (p?.colour === state.turn && pieceTargets(state.board, sq).length > 0) return true;
  }
  // No piece can move; a drop is the only way out. dropTargets works here
  // because the game isn't over yet.
  return HAND_KINDS.some((kind) => dropTargets(state, kind).length > 0);
}

/** True if `colour`'s King could be captured on the opponent's next move. */
export function inCheck(state: GameState, colour: Colour): boolean {
  const king = state.board.findIndex((p) => p?.kind === 'K' && p.colour === colour);
  if (king < 0) return false;
  for (let sq = 0; sq < SQUARES; sq++) {
    const p = state.board[sq];
    if (p && p.colour !== colour && pieceTargets(state.board, sq).includes(king)) return true;
  }
  return false;
}

/** Every legal move for the side to move: board moves, then drops. */
export function allMoves(state: GameState): Move[] {
  if (state.winner) return [];
  const moves: Move[] = [];
  for (let from = 0; from < SQUARES; from++) {
    for (const to of moveTargets(state, from)) moves.push({ type: 'move', from, to });
  }
  for (const kind of HAND_KINDS) {
    for (const to of dropTargets(state, kind)) moves.push({ type: 'drop', kind, to });
  }
  return moves;
}
