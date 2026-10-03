import { describe, expect, it } from 'vitest';
import {
  applyMove,
  dropTargets,
  type GameState,
  inCheck,
  allMoves,
  hasLegalMove,
  initialState,
  isLegal,
  positionKey,
  randomBackRank,
  moveTargets,
  type Piece,
  SQUARES,
  square,
} from './rules';

/** Builds a state from a 6-row diagram. Uppercase = white, lowercase = black. */
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

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

describe('initial position', () => {
  const rankOf = (s: GameState, r: number) =>
    Array.from({ length: 6 }, (_, c) => {
      const p = s.board[square(r, c)]!;
      return p.colour === 'w' ? p.kind : p.kind.toLowerCase();
    }).join('');

  it('mirrors the back rank for Black, behind a row of pawns each', () => {
    const s = initialState(['B', 'R', 'K', 'N', 'Q', 'R']);
    expect(rankOf(s, 0)).toBe('brknqr');
    expect(rankOf(s, 1)).toBe('pppppp');
    expect(rankOf(s, 4)).toBe('PPPPPP');
    expect(rankOf(s, 5)).toBe('BRKNQR');
    expect(s.turn).toBe('w');
  });

  it('randomBackRank always deals R, R, Q, K, N, B and covers all 360 arrangements', () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const seen = new Set<string>();
    for (let i = 0; i < 20000; i++) {
      const rank = randomBackRank(rng);
      expect([...rank].sort().join('')).toBe('BKNQRR');
      seen.add(rank.join(''));
    }
    expect(seen.size).toBe(360);
  });
});

describe('movement', () => {
  it('pawns step forward one and capture diagonally', () => {
    const s = fromDiagram(['......', '......', '.p.p..', '..P...', '......', '......']);
    expect(sorted(moveTargets(s, square(3, 2)))).toEqual(
      sorted([square(2, 1), square(2, 2), square(2, 3)]),
    );
  });

  it('pawns are blocked by a piece straight ahead', () => {
    const s = fromDiagram(['......', '......', '..p...', '..P...', '......', '......']);
    expect(moveTargets(s, square(3, 2))).toEqual([]);
  });

  it('pawns have no double step', () => {
    expect(moveTargets(initialState(), square(4, 0))).toEqual([square(3, 0)]);
  });

  it('sliders do not wrap around the board edge', () => {
    // Original bug: a rook on the right edge moving +1 wrapped to the next row.
    const s = fromDiagram(['......', '......', '.....R', '......', '......', '......']);
    const targets = moveTargets(s, square(2, 5));
    expect(targets).not.toContain(square(3, 0));
    expect(targets).toHaveLength(10);
  });

  it('bishops stop at the first piece, capturing enemies only', () => {
    const s = fromDiagram(['......', '....p.', '......', '..B...', '.P....', '......']);
    expect(sorted(moveTargets(s, square(3, 2)))).toEqual(
      sorted([square(2, 1), square(1, 0), square(2, 3), square(1, 4), square(4, 3), square(5, 4)]),
    );
  });

  it('knights jump and stay on the board', () => {
    const s = fromDiagram(['N.....', '......', '......', '......', '......', '......']);
    expect(sorted(moveTargets(s, 0))).toEqual(sorted([square(1, 2), square(2, 1)]));
  });

  it('only the side to move can move', () => {
    expect(moveTargets(initialState(), square(1, 0))).toEqual([]);
  });
});

describe('captures and drops', () => {
  it('a captured piece goes to the capturer’s hand and can be dropped', () => {
    let s = fromDiagram(['k.....', '......', '..n...', '...P..', '......', '.....K']);
    s = applyMove(s, { type: 'move', from: square(3, 3), to: square(2, 2) });
    expect(s.hands.w.N).toBe(1);
    expect(s.turn).toBe('b');
    s = applyMove(s, { type: 'move', from: 0, to: 1 });
    expect(dropTargets(s, 'N')).toHaveLength(SQUARES - 3);
    s = applyMove(s, { type: 'drop', kind: 'N', to: square(3, 3) });
    expect(s.board[square(3, 3)]).toEqual({ colour: 'w', kind: 'N' });
    expect(s.hands.w.N).toBe(0);
    expect(s.turn).toBe('b');
  });

  it('cannot drop onto an occupied square or without the piece in hand', () => {
    const s = initialState();
    expect(dropTargets(s, 'N')).toEqual([]);
    const withHand = { ...s, hands: { ...s.hands, w: { ...s.hands.w, N: 1 } } };
    expect(dropTargets(withHand, 'N')).not.toContain(square(4, 0));
    expect(() => applyMove(withHand, { type: 'drop', kind: 'N', to: square(4, 0) })).toThrow();
  });

  it('rejects malformed moves, including dropping a King', () => {
    const s = initialState();
    const bad = [
      { type: 'drop', kind: 'K', to: square(2, 0) },
      { type: 'drop', kind: 'X', to: square(2, 0) },
      { type: 'move', from: -1, to: 0 },
      { type: 'move', from: square(4, 0), to: 36 },
      { type: 'move', from: '28', to: '22' },
      null,
      'e2e3',
    ];
    for (const m of bad) expect(isLegal(s, m as never)).toBe(false);
  });

  it("pawns cannot be dropped into the opponent's starting rows", () => {
    const base = fromDiagram(['k.....', '......', '......', '......', '......', '.....K']);
    const withPawn = (turn: 'w' | 'b') => ({
      ...base,
      turn,
      hands: { w: { ...base.hands.w, P: 1 }, b: { ...base.hands.b, P: 1 } },
    });
    const rows = (turn: 'w' | 'b') =>
      [...new Set(dropTargets(withPawn(turn), 'P').map((sq) => Math.floor(sq / 6)))].sort();
    expect(rows('w')).toEqual([2, 3, 4, 5]); // not Black's rows 0–1
    expect(rows('b')).toEqual([0, 1, 2, 3]); // not White's rows 4–5
    // Other pieces can still be dropped anywhere empty.
    const s = { ...base, hands: { ...base.hands, w: { ...base.hands.w, N: 1 } } };
    expect(dropTargets(s, 'N')).toContain(square(1, 0));
  });

  it('capturing the King wins and ends the game', () => {
    let s = fromDiagram(['....k.', '......', '......', '......', '......', 'K...R.']);
    s = applyMove(s, { type: 'move', from: square(5, 4), to: square(0, 4) });
    expect(s.winner).toBe('w');
    expect(moveTargets(s, square(0, 4))).toEqual([]);
    expect(dropTargets(s, 'P')).toEqual([]);
  });

  it('allows moving into check (no check rule, as in the original)', () => {
    const s = fromDiagram(['....r.', '......', '......', '......', '......', '...K..']);
    expect(moveTargets(s, square(5, 3))).toContain(square(5, 4));
  });
});

describe('no legal moves', () => {
  // Black is completely walled in by its own pieces; nothing can move or drop.
  const walled = () =>
    fromDiagram(['.....K', '......', 'pp....', 'kp....', 'pppppp', 'rrrrrr'], 'w');

  it('hasLegalMove spots a side that is stuck', () => {
    expect(hasLegalMove(initialState())).toBe(true);
    expect(hasLegalMove({ ...walled(), turn: 'b' })).toBe(false);
  });

  it('a move that leaves the opponent with no legal move wins', () => {
    const s = applyMove(walled(), { type: 'move', from: square(0, 5), to: square(0, 4) });
    expect(s.winner).toBe('w');
    expect(s.winBy).toBe('stuck');
  });

  it('a piece in hand is a way out', () => {
    const base = walled();
    const s = applyMove(
      { ...base, hands: { ...base.hands, b: { ...base.hands.b, N: 1 } } },
      { type: 'move', from: square(0, 5), to: square(0, 4) },
    );
    expect(s.winner).toBeNull();
    expect(s.turn).toBe('b');
  });

  it('king captures are recorded as such', () => {
    let s = fromDiagram(['....k.', '......', '......', '......', '......', 'K...R.']);
    s = applyMove(s, { type: 'move', from: square(5, 4), to: square(0, 4) });
    expect(s.winBy).toBe('king');
  });
});

describe('no repetition (superko)', () => {
  const mv = (fr: number, fc: number, tr: number, tc: number) =>
    ({ type: 'move', from: square(fr, fc), to: square(tr, tc) }) as const;

  /** Plays moves while tracking seen positions, as the app and server do. */
  function playAll(moves: ReturnType<typeof mv>[]) {
    let s = initialState();
    const seen = new Set([positionKey(s)]);
    for (const m of moves) {
      s = applyMove(s, m, seen);
      seen.add(positionKey(s));
    }
    return { s, seen };
  }

  it('positionKey tells apart side to move, hands and promoted queens', () => {
    const s = initialState();
    expect(positionKey(s)).not.toBe(positionKey({ ...s, turn: 'b' }));
    expect(positionKey(s)).not.toBe(positionKey({ ...s, hands: { ...s.hands, w: { ...s.hands.w, P: 1 } } }));
    const q = fromDiagram(['k.....', '......', '..Q...', '......', '......', '.....K']);
    const promoted = { ...q, board: q.board.map((p) => (p?.kind === 'Q' ? { ...p, promoted: true } : p)) };
    expect(positionKey(q)).not.toBe(positionKey(promoted));
  });

  it('a knight shuffle cannot return to the starting position', () => {
    // White Nb1-c3, Black Nb6-c4, White Nc3-b1: Black's Nc4-b6 would repeat the start.
    const { s, seen } = playAll([mv(5, 1, 3, 2), mv(0, 1, 2, 2), mv(3, 2, 5, 1)]);
    const back = mv(2, 2, 0, 1);
    expect(moveTargets(s, square(2, 2), seen)).not.toContain(square(0, 1));
    expect(isLegal(s, back, seen)).toBe(false);
    expect(() => applyMove(s, back, seen)).toThrow();
    // Without history, repetition isn't checked (the AI's search relies on this).
    expect(isLegal(s, back)).toBe(true);
  });

  it('a player whose only moves repeat earlier positions has no legal move, and loses', () => {
    // Walled-in Black whose single legal move is the pawn capture b4xc3.
    const s0 = fromDiagram(['.....K', '......', 'pp....', 'kpN...', 'pppppp', 'rrrrrr'], 'w');
    const kingMove = mv(0, 5, 0, 4);
    const s1 = applyMove(s0, kingMove);
    expect(allMoves(s1)).toEqual([mv(2, 1, 3, 2)]);
    // Pretend the position after that capture has already happened.
    const s2 = applyMove(s1, mv(2, 1, 3, 2));
    const seen = new Set([positionKey(s0), positionKey(s2)]);
    expect(hasLegalMove(s1, new Set([...seen, positionKey(s1)]))).toBe(false);
    const result = applyMove(s0, kingMove, seen);
    expect(result.winner).toBe('w');
    expect(result.winBy).toBe('stuck');
  });
});

describe('promotion', () => {
  it('a pawn reaching the last rank becomes a queen', () => {
    let s = fromDiagram(['k.....', '...P..', '......', '......', '......', '.....K']);
    s = applyMove(s, { type: 'move', from: square(1, 3), to: square(0, 3) });
    expect(s.board[square(0, 3)]).toEqual({ colour: 'w', kind: 'Q', promoted: true });
  });

  it('a captured promoted queen goes to hand as a pawn', () => {
    let s = fromDiagram(['k.....', '...P..', '......', '......', '......', '...r.K']);
    s = applyMove(s, { type: 'move', from: square(1, 3), to: square(0, 3) });
    s = applyMove(s, { type: 'move', from: square(5, 3), to: square(0, 3) });
    expect(s.hands.b.P).toBe(1);
    expect(s.hands.b.Q).toBe(0);
  });
});

describe('inCheck', () => {
  it('detects an attacked king', () => {
    const s = fromDiagram(['....r.', '......', '......', '......', '......', '....K.']);
    expect(inCheck(s, 'w')).toBe(true);
    expect(inCheck(s, 'b')).toBe(false);
  });
});
