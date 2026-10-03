import { describe, expect, it } from 'vitest';
import { initialState } from '../engine/rules';
import type { RoomView } from '../protocol';
import { formatClock, localStatus, onlineStatus } from './status';

const view = (over: Partial<RoomView> = {}): RoomView => ({
  you: 'w',
  game: initialState(),
  clocks: { w: 180_000, b: 180_000 },
  started: true,
  running: 'w',
  abortIn: null,
  connected: { w: true, b: true },
  result: null,
  rematch: { w: false, b: false },
  ...over,
});

describe('formatClock', () => {
  it('shows m:ss, then tenths under ten seconds', () => {
    expect(formatClock(180_000)).toBe('3:00');
    expect(formatClock(61_001)).toBe('1:02');
    expect(formatClock(9_450)).toBe('0:09.4');
    expect(formatClock(-5)).toBe('0:00.0');
  });
});

describe('onlineStatus', () => {
  it('describes whose move it is, from either side', () => {
    expect(onlineStatus(null, [])).toBe('Connecting…');
    expect(onlineStatus(view(), [])).toBe('Your move');
    expect(onlineStatus(view(), ['w'])).toBe('Your move · your King is under attack');
    expect(onlineStatus(view({ you: 'b', connected: { w: false, b: true } }), []))
      .toBe('Opponent’s move · opponent offline');
    expect(onlineStatus(view({ you: null }), [])).toBe('Watching · White to move');
    expect(onlineStatus(view({ started: false }), [])).toBe('Waiting for your opponent to open the link…');
  });

  it('describes results', () => {
    expect(onlineStatus(view({ result: { winner: 'w', reason: 'resign' } }), []))
      .toBe('You win by resignation, 1–0');
    expect(onlineStatus(view({ you: 'w', result: { winner: 'b', reason: 'time' } }), []))
      .toBe('You lose on time, 0–1');
    expect(onlineStatus(view({ you: null, result: { winner: 'b', reason: 'stuck' } }), []))
      .toBe('Black wins (no legal moves left), 0–1');
    expect(onlineStatus(view({ result: { winner: null, reason: 'aborted' } }), []))
      .toMatch(/aborted/);
  });
});

describe('localStatus', () => {
  const s = initialState();
  it('describes two-player and computer games', () => {
    expect(localStatus(s, null, [])).toBe('White to move');
    expect(localStatus(s, 'b', ['w'])).toBe('Your move · your King is under attack');
    expect(localStatus(s, 'w', [])).toBe('Computer is thinking…');
  });

  it('describes results', () => {
    expect(localStatus({ ...s, winner: 'w', winBy: 'king' }, null, [])).toBe('White wins, 1–0');
    expect(localStatus({ ...s, winner: 'b', winBy: 'stuck' }, null, []))
      .toBe('Black wins: White has no legal moves, 0–1');
    expect(localStatus({ ...s, winner: 'b', winBy: 'king' }, 'b', [])).toBe('Computer wins, 0–1');
  });
});
