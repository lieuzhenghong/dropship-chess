// Server-side game logic, kept free of Cloudflare APIs so it can be unit
// tested. The server is authoritative for moves and clocks.
//
// Clock rules (as on most chess sites): each side's first move is untimed but
// must be made within FIRST_MOVE_MS, or the game is aborted with no result.
// The clocks start once both sides have made their first move.

import { applyMove, type Colour, type GameState, initialState, isLegal, type Move, other } from '../../src/engine/rules';
import {
  FINISHED_GAME_TTL_MS,
  FIRST_MOVE_MS,
  type GameResult,
  IDLE_GAME_TTL_MS,
  INCREMENT_MS,
  INITIAL_CLOCK_MS,
} from '../../src/protocol';

export interface Room {
  readonly tokens: Readonly<Partial<Record<Colour, string>>>;
  readonly game: GameState;
  /** Moves made so far; the first two are untimed. */
  readonly plies: number;
  /** Remaining time per side as of `turnStart` (the mover's clock excludes the current turn). */
  readonly clocks: Readonly<Record<Colour, number>>;
  /** When the side to move's clock started running; null while no clock runs. */
  readonly turnStart: number | null;
  /** Deadline for the side to move's untimed first move; null otherwise. */
  readonly abortAt: number | null;
  readonly result: GameResult | null;
  /** Last change to the room, which drives deletion. */
  readonly updatedAt: number;
}

export type Outcome = { room: Room; error?: string };

export function newRoom(now = 0): Room {
  return {
    tokens: {},
    game: initialState(),
    plies: 0,
    clocks: { w: INITIAL_CLOCK_MS, b: INITIAL_CLOCK_MS },
    turnStart: null,
    abortAt: null,
    result: null,
    updatedAt: now,
  };
}

/** Fills in fields missing from rooms saved by older versions of the server. */
export function upgradeRoom(stored: Partial<Room>, now: number): Room {
  const room = { ...newRoom(now), ...stored };
  if (stored.plies === undefined) {
    // Old rooms started their clock as soon as Black joined.
    return { ...room, plies: stored.turnStart != null || stored.result ? 2 : 0 };
  }
  return room;
}

/** Remaining time for each side at `now`, counting the running turn. */
export function clocksAt(room: Room, now: number): Record<Colour, number> {
  const clocks = { ...room.clocks };
  if (room.turnStart !== null && !room.result) {
    const turn = room.game.turn;
    clocks[turn] = Math.max(0, clocks[turn] - (now - room.turnStart));
  }
  return clocks;
}

export function runningClock(room: Room): Colour | null {
  return room.turnStart !== null && !room.result ? room.game.turn : null;
}

export const isStarted = (room: Room): boolean => !!room.tokens.b;

/** Ends the game if the side to move has run out of time or missed the first-move deadline. */
export function checkTimeouts(room: Room, now: number): Room {
  if (room.result) return room;
  if (room.abortAt !== null && now >= room.abortAt) {
    return { ...room, abortAt: null, result: { winner: null, reason: 'aborted' }, updatedAt: now };
  }
  const clocks = clocksAt(room, now);
  const turn = room.game.turn;
  if (room.turnStart === null || clocks[turn] > 0) return room;
  return {
    ...room,
    clocks,
    turnStart: null,
    result: { winner: other(turn), reason: 'time' },
    updatedAt: now,
  };
}

/**
 * Seats a player by token: a returning token gets its old seat, otherwise the
 * first newcomer is White and the second Black; later newcomers spectate.
 * White's first-move deadline starts when Black joins.
 */
export function join(room: Room, token: string, now: number): { room: Room; seat: Colour | null } {
  for (const c of ['w', 'b'] as const) if (room.tokens[c] === token) return { room, seat: c };
  if (!room.tokens.w) {
    return { room: { ...room, tokens: { ...room.tokens, w: token }, updatedAt: now }, seat: 'w' };
  }
  if (!room.tokens.b) {
    return {
      room: { ...room, tokens: { ...room.tokens, b: token }, abortAt: now + FIRST_MOVE_MS, updatedAt: now },
      seat: 'b',
    };
  }
  return { room, seat: null };
}

export function move(room: Room, seat: Colour | null, mv: Move, now: number): Outcome {
  room = checkTimeouts(room, now);
  if (room.result) return { room, error: 'The game is over.' };
  if (!isStarted(room)) return { room, error: 'Waiting for an opponent.' };
  if (seat !== room.game.turn) return { room, error: 'Not your turn.' };
  if (!isLegal(room.game, mv)) return { room, error: 'Illegal move.' };

  const game = applyMove(room.game, mv);
  const plies = room.plies + 1;
  const timed = room.turnStart !== null;
  const clocks = clocksAt(room, now);
  if (timed) clocks[seat] += INCREMENT_MS;
  const result: GameResult | null = game.winner ? { winner: game.winner, reason: 'king' } : null;
  return {
    room: {
      ...room,
      game,
      plies,
      clocks,
      // After White's first move, Black gets an untimed first move too; after
      // Black's, the clocks start.
      turnStart: result || plies < 2 ? null : now,
      abortAt: result || plies >= 2 ? null : now + FIRST_MOVE_MS,
      result,
      updatedAt: now,
    },
  };
}

/** When the room should be deleted. */
export const expiresAt = (room: Room): number =>
  room.updatedAt + (room.result ? FINISHED_GAME_TTL_MS : IDLE_GAME_TTL_MS);

/**
 * The next time the server must wake up for this room: the first-move
 * deadline, the side to move running out of time, or deletion.
 */
export function nextWake(room: Room): number {
  const times = [expiresAt(room)];
  if (!room.result) {
    if (room.abortAt !== null) times.push(room.abortAt);
    if (room.turnStart !== null) times.push(room.turnStart + room.clocks[room.game.turn]);
  }
  return Math.min(...times);
}
