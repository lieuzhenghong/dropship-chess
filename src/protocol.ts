// Messages exchanged between the web client and the game server (server/).

import type { Colour, GameState, Move } from './engine/rules';

/** Time each player starts with. */
export const INITIAL_CLOCK_MS = 3 * 60 * 1000;

export type ClientMessage =
  /** Sent on every (re)connect. `token` identifies the player across reconnects. */
  | { t: 'join'; token: string }
  | { t: 'move'; move: Move }
  /** Asks the server to end the game if the side to move has run out of time. */
  | { t: 'flag' };

export interface GameResult {
  readonly winner: Colour;
  readonly reason: 'king' | 'time';
}

export interface RoomView {
  /** The receiving player's colour, or null for a spectator. */
  readonly you: Colour | null;
  readonly game: GameState;
  /** Remaining time per side, as of when the server sent this message. */
  readonly clocks: Readonly<Record<Colour, number>>;
  /** Whose clock is running, or null before both players join and after the end. */
  readonly running: Colour | null;
  /** Which players currently have a live connection. */
  readonly connected: Readonly<Record<Colour, boolean>>;
  readonly result: GameResult | null;
}

export type ServerMessage =
  | ({ t: 'state' } & RoomView)
  | { t: 'error'; message: string };
