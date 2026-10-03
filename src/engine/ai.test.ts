import { describe, expect, it } from 'vitest';
import { chooseMove } from './ai';
import { applyMove, type GameState, initialState, isLegal, type Piece, SQUARES, square } from './rules';

function fromDiagram(rows: string[], turn: 'w' | 'b' = 'w'): GameState {
  const board: (Piece | null)[] = new Array(SQUARES).fill(null);
  rows.forEach((line, r) =>
    [...line].forEach((ch, c) => {
      if (ch === '.') return;
      const colour = ch === ch.toUpperCase() ? 'w' : 'b';
      board[square(r, c)] = { colour, kind: ch.toUpperCase() as Piece['kind'] };
    }),
  );
  const empty = { P: 0, N: 0, B: 0, R: 0, Q: 0 };
  return { ...initialState(), board, turn, hands: { w: { ...empty }, b: { ...empty } } };
}

/** Deterministic RNG so tests don't flake. */
function seeded(seed: number): () => number {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('chooseMove', () => {
  it('captures the king when it can', () => {
    const s = fromDiagram(['k.....', '......', '......', '......', '......', 'R....K']);
    expect(chooseMove(s, undefined, seeded(1))).toEqual({ type: 'move', from: square(5, 0), to: 0 });
  });

  it('takes a hanging queen', () => {
    const s = fromDiagram(['k.....', '......', '..q...', '......', '......', '..R..K']);
    expect(chooseMove(s, undefined, seeded(2))).toEqual({ type: 'move', from: square(5, 2), to: square(2, 2) });
  });

  it('does not grab a defended pawn with its queen', () => {
    // Qxb5 wins a pawn, but the c6 pawn then recaptures the queen.
    const s = fromDiagram(['k.p...', '.p....', '......', '......', '.Q....', '.....K']);
    const move = chooseMove(s, undefined, seeded(3));
    expect(move).not.toEqual({ type: 'move', from: square(4, 1), to: square(1, 1) });
  });

  it('returns null when the game is over', () => {
    expect(chooseMove({ ...initialState(), winner: 'w' })).toBeNull();
  });

  it('only plays legal moves in self-play', () => {
    let s = initialState();
    const rng = seeded(4);
    for (let ply = 0; ply < 80 && !s.winner; ply++) {
      const move = chooseMove(s, undefined, rng)!;
      expect(isLegal(s, move)).toBe(true);
      s = applyMove(s, move);
    }
  });
});
