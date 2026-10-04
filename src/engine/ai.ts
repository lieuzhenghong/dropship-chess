// A simple computer opponent: negamax with alpha-beta pruning.
//
// - Iterative deepening: searches 1 ply, then 2, 3, ... until a time budget
//   runs out, and plays the best move from the deepest completed search. Fast
//   devices search deeper; slow ones still answer on time.
// - Move ordering: captures first (most valuable victim, then least valuable
//   attacker), and the previous iteration's best move first at the root. This
//   makes alpha-beta prune far more, which is what pays for the extra depth.
// - Quiescence: at the depth limit, captures are searched until the position
//   is quiet, so it doesn't count a piece as won when it's about to be
//   recaptured.
// - Evaluation: material, counting pieces in hand, plus a penalty for squares
//   next to each King that the opponent attacks or could drop onto. (A
//   hand-piece bonus and an advanced-pawn bonus were tried; ai-match showed no
//   measurable gain, so they were dropped.)
//
// Root moves are shuffled first, so equally scored moves vary between games.
// scripts/ai-match.ts measures changes; see the README for results.

import {
  allMoves,
  applyMove,
  type Colour,
  col,
  type GameState,
  HAND_KINDS,
  type Kind,
  type Move,
  other,
  pieceTargets,
  row,
  SIZE,
  SQUARES,
} from './rules';

const VALUE: Record<Kind, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
const WIN = 1000;

export interface SearchOptions {
  /** Stop starting deeper searches after this long (ms). */
  timeMs?: number;
  /** Never search deeper than this many plies. */
  maxDepth?: number;
  rng?: () => number;
  /** At the depth limit, keep searching captures until the position is quiet. Default on. */
  quiescence?: boolean;
  /** Penalise attacked and droppable squares around each King. Default on. */
  kingSafety?: boolean;
  /** Filled in with the deepest completed search depth, for measurement. */
  stats?: { depth: number };
}

const DEFAULTS = { timeMs: 250, maxDepth: 8, quiescence: true, kingSafety: true };

/** Penalty per square next to a King that the opponent attacks. */
const ATTACKED_PENALTY = 0.5;
/** Penalty per empty square next to a King while the opponent holds a piece to drop. */
const DROPPABLE_PENALTY = 0.25;

/** How exposed `colour`'s King is: attacked neighbours, and empty ones the opponent could drop onto. */
function kingDanger(state: GameState, colour: Colour): number {
  const king = state.board.findIndex((p) => p?.kind === 'K' && p.colour === colour);
  if (king < 0) return 0;
  const enemy = other(colour);
  const attacked = new Set<number>();
  for (let sq = 0; sq < SQUARES; sq++) {
    if (state.board[sq]?.colour === enemy) for (const t of pieceTargets(state.board, sq)) attacked.add(t);
  }
  const canDrop = HAND_KINDS.some((k) => state.hands[enemy][k] > 0);
  let danger = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = row(king) + dr;
      const c = col(king) + dc;
      if ((!dr && !dc) || r < 0 || r >= SIZE || c < 0 || c >= SIZE) continue;
      const sq = r * SIZE + c;
      if (attacked.has(sq)) danger += ATTACKED_PENALTY;
      if (canDrop && !state.board[sq]) danger += DROPPABLE_PENALTY;
    }
  }
  return danger;
}

/** Material balance from `colour`'s point of view, counting pieces in hand. */
export function evaluate(state: GameState, colour: Colour, kingSafety = false): number {
  if (state.winner) return state.winner === colour ? WIN : -WIN;
  let score = 0;
  for (const p of state.board) {
    if (p) score += p.colour === colour ? VALUE[p.kind] : -VALUE[p.kind];
  }
  for (const kind of HAND_KINDS) {
    score += VALUE[kind] * (state.hands[colour][kind] - state.hands[other(colour)][kind]);
  }
  if (kingSafety) score += kingDanger(state, other(colour)) - kingDanger(state, colour);
  return score;
}

/** Captures first, most valuable victim then least valuable attacker; others keep their order. */
function ordered(state: GameState, moves: Move[]): Move[] {
  const key = (m: Move) => {
    if (m.type !== 'move') return 0;
    const victim = state.board[m.to];
    if (!victim) return 0;
    return 100 + (victim.kind === 'K' ? 50 : VALUE[victim.kind]) * 10 - VALUE[state.board[m.from]!.kind];
  };
  return moves
    .map((m, i) => ({ m, k: key(m), i }))
    .sort((a, b) => b.k - a.k || a.i - b.i)
    .map((x) => x.m);
}

class Timeout extends Error {}

function shuffle<T>(xs: T[], rng: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

/** Picks a move for the side to move, or null if the game is over. */
export function chooseMove(state: GameState, opts: SearchOptions = {}): Move | null {
  const { timeMs, maxDepth, quiescence, kingSafety } = { ...DEFAULTS, ...opts };
  const rng = opts.rng ?? Math.random;
  const deadline = Date.now() + timeMs;
  let nodes = 0;
  const tick = () => {
    // Checking the clock is cheap, but not free; do it every 1024 nodes.
    if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new Timeout();
  };
  const evaluateHere = (s: GameState) => evaluate(s, s.turn, kingSafety);

  /** Captures only, until none is worth making; the side to move may also "stand pat". */
  function quiesce(s: GameState, alpha: number, beta: number): number {
    tick();
    const stand = evaluateHere(s);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    const captures: Move[] = [];
    for (let from = 0; from < SQUARES; from++) {
      if (s.board[from]?.colour !== s.turn) continue;
      for (const to of pieceTargets(s.board, from)) {
        if (s.board[to]) captures.push({ type: 'move', from, to });
      }
    }
    for (const move of ordered(s, captures)) {
      const next = applyMove(s, move);
      const score = next.winner ? WIN : -quiesce(next, -beta, -alpha);
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(s: GameState, depth: number, alpha: number, beta: number): number {
    tick();
    if (s.winner) return evaluateHere(s);
    if (depth === 0) return quiescence ? quiesce(s, alpha, beta) : evaluateHere(s);
    let best = -Infinity;
    for (const move of ordered(s, allMoves(s))) {
      const next = applyMove(s, move);
      // The turn passes to the opponent unless this move ended the game.
      const score = next.winner ? WIN + depth : -negamax(next, depth - 1, -beta, -alpha);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  let rootMoves = ordered(state, shuffle(allMoves(state), rng));
  if (rootMoves.length === 0) return null;
  let best = rootMoves[0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    let bestAtDepth: Move | null = null;
    let bestScore = -Infinity;
    try {
      for (const move of rootMoves) {
        const next = applyMove(state, move);
        const score = next.winner ? WIN + depth : -negamax(next, depth - 1, -Infinity, -bestScore);
        if (score > bestScore) {
          bestScore = score;
          bestAtDepth = move;
        }
      }
    } catch (e) {
      if (e instanceof Timeout) break; // keep the last completed depth's choice
      throw e;
    }
    best = bestAtDepth!;
    if (opts.stats) opts.stats.depth = depth;
    // A forced win needs no deeper search.
    if (bestScore >= WIN) break;
    // Search the best move first next time: it tightens the window early.
    rootMoves = [best, ...rootMoves.filter((m) => m !== best)];
    if (Date.now() > deadline) break;
  }
  return best;
}
