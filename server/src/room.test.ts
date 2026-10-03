import { describe, expect, it } from 'vitest';
import { square } from '../../src/engine/rules';
import { INCREMENT_MS, INITIAL_CLOCK_MS } from '../../src/protocol';
import { checkFlag, clocksAt, join, move, newRoom, type Room, runningClock } from './room';

const e2e3 = { type: 'move', from: square(4, 4), to: square(3, 4) } as const;
const b5b4 = { type: 'move', from: square(1, 1), to: square(2, 1) } as const;

function started(now = 0): Room {
  let room = join(newRoom(), 'alice', now).room;
  room = join(room, 'bob', now).room;
  return room;
}

describe('join', () => {
  it('seats White, then Black, then spectators, and remembers tokens', () => {
    let r = newRoom();
    let seat;
    ({ room: r, seat } = join(r, 'alice', 0));
    expect(seat).toBe('w');
    expect(runningClock(r)).toBeNull();
    ({ room: r, seat } = join(r, 'bob', 5));
    expect(seat).toBe('b');
    expect(r.turnStart).toBe(5);
    expect(join(r, 'carol', 6).seat).toBeNull();
    expect(join(r, 'alice', 7).seat).toBe('w');
    expect(join(r, 'bob', 7).room).toBe(r);
  });
});

describe('move', () => {
  it('rejects moves before Black joins, out of turn, or illegal', () => {
    const lone = join(newRoom(), 'alice', 0).room;
    expect(move(lone, 'w', e2e3, 1).error).toMatch(/opponent/);
    const r = started();
    expect(move(r, 'b', b5b4, 1).error).toMatch(/turn/);
    expect(move(r, null, e2e3, 1).error).toMatch(/turn/);
    expect(move(r, 'w', { type: 'move', from: square(4, 4), to: square(2, 4) }, 1).error).toMatch(/Illegal/);
  });

  it('charges the mover for the time taken, adds the increment, and starts the other clock', () => {
    let r = started(0);
    r = move(r, 'w', e2e3, 10_000).room;
    expect(r.clocks.w).toBe(INITIAL_CLOCK_MS - 10_000 + INCREMENT_MS);
    expect(r.game.turn).toBe('b');
    expect(clocksAt(r, 14_000).b).toBe(INITIAL_CLOCK_MS - 4_000);
    r = move(r, 'b', b5b4, 15_000).room;
    expect(r.clocks).toEqual({
      w: INITIAL_CLOCK_MS - 10_000 + INCREMENT_MS,
      b: INITIAL_CLOCK_MS - 5_000 + INCREMENT_MS,
    });
  });

  it('the increment can take a clock above its starting time', () => {
    let r = started(0);
    r = move(r, 'w', e2e3, 500).room;
    expect(r.clocks.w).toBe(INITIAL_CLOCK_MS + INCREMENT_MS - 500);
  });

  it('a move after the clock ran out loses on time instead', () => {
    const r = started(0);
    const { room, error } = move(r, 'w', e2e3, INITIAL_CLOCK_MS + 1);
    expect(error).toMatch(/over/);
    expect(room.result).toEqual({ winner: 'b', reason: 'time' });
    expect(room.clocks.w).toBe(0);
    expect(room.game.board).toEqual(r.game.board);
  });

  it('records a king capture as the result and stops the clocks', () => {
    const r = started(0);
    const board = r.game.board.map(() => null) as (typeof r.game.board)[number][];
    board[square(0, 3)] = { colour: 'b', kind: 'K' };
    board[square(2, 3)] = { colour: 'w', kind: 'Q' };
    board[square(5, 3)] = { colour: 'w', kind: 'K' };
    const s = move({ ...r, game: { ...r.game, board } }, 'w',
      { type: 'move', from: square(2, 3), to: square(0, 3) }, 1).room;
    expect(s.result).toEqual({ winner: 'w', reason: 'king' });
    expect(runningClock(s)).toBeNull();
  });
});

describe('checkFlag', () => {
  it('only ends the game once the running clock reaches zero', () => {
    const r = started(0);
    expect(checkFlag(r, INITIAL_CLOCK_MS - 1)).toBe(r);
    expect(checkFlag(r, INITIAL_CLOCK_MS).result).toEqual({ winner: 'b', reason: 'time' });
  });

  it('does nothing before the game starts', () => {
    const r = join(newRoom(), 'alice', 0).room;
    expect(checkFlag(r, 10 * INITIAL_CLOCK_MS)).toBe(r);
  });
});
