// Server-side game logic, kept free of Cloudflare APIs so it can be unit
// tested. The server is authoritative for moves and clocks.

import { applyMove, type Colour, type GameState, initialState, isLegal, type Move, other } from '../../src/engine/rules';
import { type GameResult, INCREMENT_MS, INITIAL_CLOCK_MS } from '../../src/protocol';

export interface Room {
  readonly tokens: Readonly<Partial<Record<Colour, string>>>;
  readonly game: GameState;
  /** Remaining time per side as of `turnStart` (the mover's clock excludes the current turn). */
  readonly clocks: Readonly<Record<Colour, number>>;
  /** When the side to move's clock started running; null until both players have joined. */
  readonly turnStart: number | null;
  readonly result: GameResult | null;
}

export type Outcome = { room: Room; error?: string };

export function newRoom(): Room {
  return {
    tokens: {},
    game: initialState(),
    clocks: { w: INITIAL_CLOCK_MS, b: INITIAL_CLOCK_MS },
    turnStart: null,
    result: null,
  };
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

/** Ends the game on time if the side to move has run out. */
export function checkFlag(room: Room, now: number): Room {
  const clocks = clocksAt(room, now);
  const turn = room.game.turn;
  if (room.turnStart === null || room.result || clocks[turn] > 0) return room;
  return { ...room, clocks, turnStart: null, result: { winner: other(turn), reason: 'time' } };
}

/**
 * Seats a player by token: a returning token gets its old seat, otherwise the
 * first newcomer is White and the second Black; later newcomers spectate.
 * White's clock starts when Black first joins.
 */
export function join(room: Room, token: string, now: number): { room: Room; seat: Colour | null } {
  for (const c of ['w', 'b'] as const) if (room.tokens[c] === token) return { room, seat: c };
  if (!room.tokens.w) return { room: { ...room, tokens: { ...room.tokens, w: token } }, seat: 'w' };
  if (!room.tokens.b) {
    return { room: { ...room, tokens: { ...room.tokens, b: token }, turnStart: now }, seat: 'b' };
  }
  return { room, seat: null };
}

export function move(room: Room, seat: Colour | null, mv: Move, now: number): Outcome {
  room = checkFlag(room, now);
  if (room.result) return { room, error: 'The game is over.' };
  if (room.turnStart === null) return { room, error: 'Waiting for an opponent.' };
  if (seat !== room.game.turn) return { room, error: 'Not your turn.' };
  if (!isLegal(room.game, mv)) return { room, error: 'Illegal move.' };

  const game = applyMove(room.game, mv);
  const clocks = clocksAt(room, now);
  clocks[seat] += INCREMENT_MS;
  const result: GameResult | null = game.winner ? { winner: game.winner, reason: 'king' } : null;
  return { room: { ...room, game, clocks, turnStart: result ? null : now, result } };
}
