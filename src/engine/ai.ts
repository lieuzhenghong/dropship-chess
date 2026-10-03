// A deliberately simple opponent for testing: a fixed-depth negamax search
// (three plies by default: its move, the reply, its next move) with
// alpha-beta pruning over a material-only evaluation. Moves are shuffled first, so equally scored moves vary
// between games.

import { allMoves, applyMove, type Colour, type GameState, HAND_KINDS, type Kind, type Move } from './rules';

const VALUE: Record<Kind, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
const WIN = 1000;

/** Material balance from `colour`'s point of view, counting pieces in hand. */
export function evaluate(state: GameState, colour: Colour): number {
  if (state.winner) return state.winner === colour ? WIN : -WIN;
  let score = 0;
  for (const p of state.board) {
    if (p) score += p.colour === colour ? VALUE[p.kind] : -VALUE[p.kind];
  }
  for (const kind of HAND_KINDS) {
    score += VALUE[kind] * (state.hands[colour][kind] - state.hands[colour === 'w' ? 'b' : 'w'][kind]);
  }
  return score;
}

function negamax(state: GameState, depth: number, alpha: number, beta: number): number {
  // A finished game is scored from the side to move's view; after a king
  // capture `turn` stays with the winner, so this is +WIN for them.
  if (depth === 0 || state.winner) return evaluate(state, state.turn);
  let best = -Infinity;
  for (const move of allMoves(state)) {
    const next = applyMove(state, move);
    // The turn passes to the opponent unless this move ended the game.
    const score = next.winner ? WIN + depth : -negamax(next, depth - 1, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function shuffle<T>(xs: T[], rng: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

/** Picks a move for the side to move, or null if the game is over. */
export function chooseMove(state: GameState, depth = 3, rng: () => number = Math.random): Move | null {
  const moves = shuffle(allMoves(state), rng);
  let best: Move | null = null;
  let bestScore = -Infinity;
  for (const move of moves) {
    const next = applyMove(state, move);
    const score = next.winner ? WIN + depth : -negamax(next, depth - 1, -Infinity, -bestScore);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}
