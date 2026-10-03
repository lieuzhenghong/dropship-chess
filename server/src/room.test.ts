import { describe, expect, it } from 'vitest';
import { square } from '../../src/engine/rules';
import { FIRST_MOVE_MS, INCREMENT_MS, INITIAL_CLOCK_MS } from '../../src/protocol';
import {
  checkTimeouts,
  clocksAt,
  join,
  move,
  newRoom,
  rematch,
  resign,
  type Room,
  runningClock,
  seatOf,
} from './room';

const e2e3 = { type: 'move', from: square(4, 4), to: square(3, 4) } as const;
const b5b4 = { type: 'move', from: square(1, 1), to: square(2, 1) } as const;
const a2a3 = { type: 'move', from: square(4, 0), to: square(3, 0) } as const;
const f5f4 = { type: 'move', from: square(1, 5), to: square(2, 5) } as const;

function joined(now = 0): Room {
  let room = join(newRoom(), 'alice', now).room;
  room = join(room, 'bob', now).room;
  return room;
}

/** Both untimed first moves made, at t=1000 and t=2000; White's clock runs from 2000. */
function clocking(): Room {
  let r = move(joined(0), 'w', e2e3, 1000).room;
  r = move(r, 'b', b5b4, 2000).room;
  return r;
}

describe('join', () => {
  it('seats White, then Black, then spectators, and remembers tokens', () => {
    let r = newRoom();
    let seat;
    ({ room: r, seat } = join(r, 'alice', 0));
    expect(seat).toBe('w');
    expect(r.abortAt).toBeNull();
    ({ room: r, seat } = join(r, 'bob', 5));
    expect(seat).toBe('b');
    expect(r.abortAt).toBe(5 + FIRST_MOVE_MS);
    expect(runningClock(r)).toBeNull();
    expect(join(r, 'carol', 6).seat).toBeNull();
    expect(join(r, 'alice', 7).seat).toBe('w');
    expect(join(r, 'bob', 7).room).toBe(r);
  });
});

describe('untimed first moves', () => {
  it('runs no clock until both sides have made their first move', () => {
    let r = joined(0);
    r = move(r, 'w', e2e3, 20_000).room;
    expect(r.clocks).toEqual({ w: INITIAL_CLOCK_MS, b: INITIAL_CLOCK_MS });
    expect(runningClock(r)).toBeNull();
    expect(r.abortAt).toBe(20_000 + FIRST_MOVE_MS);
    r = move(r, 'b', b5b4, 45_000).room;
    expect(r.clocks).toEqual({ w: INITIAL_CLOCK_MS, b: INITIAL_CLOCK_MS });
    expect(runningClock(r)).toBe('w');
    expect(r.abortAt).toBeNull();
    expect(r.turnStart).toBe(45_000);
  });

  it('aborts with no result if a first move is not made in time', () => {
    const r = joined(0);
    expect(checkTimeouts(r, FIRST_MOVE_MS - 1)).toBe(r);
    expect(checkTimeouts(r, FIRST_MOVE_MS).result).toEqual({ winner: null, reason: 'aborted' });
    const afterWhite = move(r, 'w', e2e3, 1000).room;
    expect(checkTimeouts(afterWhite, 1000 + FIRST_MOVE_MS).result).toEqual({ winner: null, reason: 'aborted' });
    expect(move(r, 'w', e2e3, FIRST_MOVE_MS + 1).error).toMatch(/over/);
  });
});

describe('move', () => {
  it('rejects moves before Black joins, out of turn, or illegal', () => {
    const lone = join(newRoom(), 'alice', 0).room;
    expect(move(lone, 'w', e2e3, 1).error).toMatch(/opponent/);
    const r = joined();
    expect(move(r, 'b', b5b4, 1).error).toMatch(/turn/);
    expect(move(r, null, e2e3, 1).error).toMatch(/turn/);
    expect(move(r, 'w', { type: 'move', from: square(4, 4), to: square(2, 4) }, 1).error).toMatch(/Illegal/);
  });

  it('charges timed moves, adds the increment, and starts the other clock', () => {
    let r = clocking();
    r = move(r, 'w', a2a3, 12_000).room;
    expect(r.clocks.w).toBe(INITIAL_CLOCK_MS - 10_000 + INCREMENT_MS);
    expect(clocksAt(r, 16_000).b).toBe(INITIAL_CLOCK_MS - 4_000);
    r = move(r, 'b', f5f4, 17_000).room;
    expect(r.clocks).toEqual({
      w: INITIAL_CLOCK_MS - 10_000 + INCREMENT_MS,
      b: INITIAL_CLOCK_MS - 5_000 + INCREMENT_MS,
    });
  });

  it('a move after the clock ran out loses on time instead', () => {
    const r = clocking();
    const { room, error } = move(r, 'w', a2a3, 2000 + INITIAL_CLOCK_MS);
    expect(error).toMatch(/over/);
    expect(room.result).toEqual({ winner: 'b', reason: 'time' });
    expect(room.clocks.w).toBe(0);
    expect(room.game.board).toEqual(r.game.board);
  });

  it('records a king capture as the result and stops the clocks', () => {
    const r = clocking();
    const board = r.game.board.map(() => null) as (typeof r.game.board)[number][];
    board[square(0, 3)] = { colour: 'b', kind: 'K' };
    board[square(2, 3)] = { colour: 'w', kind: 'Q' };
    board[square(5, 3)] = { colour: 'w', kind: 'K' };
    const s = move({ ...r, game: { ...r.game, board } }, 'w',
      { type: 'move', from: square(2, 3), to: square(0, 3) }, 3000).room;
    expect(s.result).toEqual({ winner: 'w', reason: 'king' });
    expect(runningClock(s)).toBeNull();
  });
});

describe('no legal moves', () => {
  it('ends the game with reason "stuck"', () => {
    const r = clocking();
    // Black walled in by its own pieces; White's king move leaves Black stuck.
    const rows = ['.....K', '......', 'pp....', 'kp....', 'pppppp', 'rrrrrr'];
    const board = rows.flatMap((line) => [...line].map((ch) =>
      ch === '.' ? null : { colour: ch === ch.toUpperCase() ? 'w' : 'b', kind: ch.toUpperCase() },
    )) as (typeof r.game.board)[number][];
    const s = move({ ...r, game: { ...r.game, board, turn: 'w' } }, 'w',
      { type: 'move', from: square(0, 5), to: square(0, 4) }, 3000).room;
    expect(s.result).toEqual({ winner: 'w', reason: 'stuck' });
    expect(runningClock(s)).toBeNull();
  });
});

describe('resign and rematch', () => {
  it('resigning loses for the resigner and stops the clocks', () => {
    const { room, error } = resign(clocking(), 'b', 5000);
    expect(error).toBeUndefined();
    expect(room.result).toEqual({ winner: 'w', reason: 'resign' });
    expect(runningClock(room)).toBeNull();
    expect(resign(room, 'w', 6000).error).toMatch(/over/);
    expect(resign(joined(0), null, 1).error).toBeDefined();
  });

  it('a rematch needs both players, then swaps colours and starts fresh', () => {
    const over = resign(clocking(), 'b', 5000).room;
    expect(rematch(clocking(), 'w', 5000).error).toMatch(/still going/);
    const asked = rematch(over, 'w', 6000).room;
    expect(asked.rematch).toEqual({ w: true });
    expect(asked.result).not.toBeNull();
    expect(rematch(asked, null, 6000).error).toBeDefined();
    const fresh = rematch(asked, 'b', 7000).room;
    expect(fresh.result).toBeNull();
    expect(fresh.plies).toBe(0);
    expect(fresh.rematch).toEqual({});
    expect(seatOf(fresh, 'alice')).toBe('b');
    expect(seatOf(fresh, 'bob')).toBe('w');
    expect(fresh.abortAt).toBe(7000 + FIRST_MOVE_MS);
  });
});

describe('checkTimeouts', () => {
  it('ends the game once the running clock reaches zero', () => {
    const r = clocking();
    expect(checkTimeouts(r, 2000 + INITIAL_CLOCK_MS - 1)).toBe(r);
    expect(checkTimeouts(r, 2000 + INITIAL_CLOCK_MS).result).toEqual({ winner: 'b', reason: 'time' });
  });

  it('does nothing before an opponent joins', () => {
    const r = join(newRoom(), 'alice', 0).room;
    expect(checkTimeouts(r, 10 * INITIAL_CLOCK_MS)).toBe(r);
  });
});
