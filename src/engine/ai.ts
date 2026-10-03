// A simple computer opponent: negamax with alpha-beta pruning.
//
// - Iterative deepening: searches 1 ply, then 2, 3, ... until a time budget
//   runs out, and plays the best move from the deepest completed search. Fast
//   devices search deeper; slow ones still answer on time.
// - Move ordering: captures first (most valuable victim, then least valuable
//   attacker), and the previous iteration's best move first at the root. This
//   makes alpha-beta prune far more, which is what pays for the extra depth.
// - Evaluation: material only, counting pieces in hand. (A hand-piece bonus
//   and an advanced-pawn bonus were tried; ai-match showed no measurable gain,
//   so they were dropped.)
//
// Root moves are shuffled first, so equally scored moves vary between games.
// scripts/ai-match.ts measures this against the original fixed-depth AI.

import {
  allMoves,
  applyMove,
  type Colour,
  type GameState,
  HAND_KINDS,
  type Kind,
  type Move,
  other,
  type Seen,
} from './rules';

const VALUE: Record<Kind, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
const WIN = 1000;

export interface SearchOptions {
  /** Stop starting deeper searches after this long (ms). */
  timeMs?: number;
  /** Never search deeper than this many plies. */
  maxDepth?: number;
  /**
   * Positions so far, so the AI's own move never repeats one (superko). Only
   * the move it plays is checked; the search below ignores repetition.
   */
  seen?: Seen;
  rng?: () => number;
}

const DEFAULTS = { timeMs: 250, maxDepth: 8 };

/** Material balance from `colour`'s point of view, counting pieces in hand. */
export function evaluate(state: GameState, colour: Colour): number {
  if (state.winner) return state.winner === colour ? WIN : -WIN;
  let score = 0;
  for (const p of state.board) {
    if (p) score += p.colour === colour ? VALUE[p.kind] : -VALUE[p.kind];
  }
  for (const kind of HAND_KINDS) {
    score += VALUE[kind] * (state.hands[colour][kind] - state.hands[other(colour)][kind]);
  }
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
  const { timeMs, maxDepth } = { ...DEFAULTS, ...opts };
  const rng = opts.rng ?? Math.random;
  const deadline = Date.now() + timeMs;
  let nodes = 0;

  function negamax(s: GameState, depth: number, alpha: number, beta: number): number {
    // Checking the clock is cheap, but not free; do it every 1024 nodes.
    if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new Timeout();
    if (depth === 0 || s.winner) return evaluate(s, s.turn);
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

  let rootMoves = ordered(state, shuffle(allMoves(state, opts.seen), rng));
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
    // A forced win needs no deeper search.
    if (bestScore >= WIN) break;
    // Search the best move first next time: it tightens the window early.
    rootMoves = [best, ...rootMoves.filter((m) => m !== best)];
    if (Date.now() > deadline) break;
  }
  return best;
}
