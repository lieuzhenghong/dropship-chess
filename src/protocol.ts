// Messages exchanged between the web client and the game server (server/).

import type { Colour, GameState, Move } from './engine/rules';

/** Time each player starts with. */
export const INITIAL_CLOCK_MS = 3 * 60 * 1000;
/** Time added to a player's clock after each of their timed moves (3+2). */
export const INCREMENT_MS = 2 * 1000;
/**
 * Each side's first move is untimed, but must be made within this long or the
 * game is aborted with no result.
 */
export const FIRST_MOVE_MS = 30 * 1000;


export type ClientMessage =
  /** Sent on every (re)connect. `token` identifies the player across reconnects. */
  | { t: 'join'; token: string }
  | { t: 'move'; move: Move }
  /**
   * Asks the server to end the game if the side to move has run out of time
   * or missed the first-move deadline. The server has no timers of its own:
   * it checks deadlines whenever a message arrives.
   */
  | { t: 'flag' }
  | { t: 'resign' }
  /** After a game ends: asks for (or accepts) a rematch with colours swapped. */
  | { t: 'rematch' };

export interface GameResult {
  /** Null when the game was aborted. */
  readonly winner: Colour | null;
  /** 'stuck': the loser had no legal move. */
  readonly reason: 'king' | 'time' | 'stuck' | 'resign' | 'aborted';
}

export interface RoomView {
  /** The receiving player's colour, or null for a spectator. */
  readonly you: Colour | null;
  readonly game: GameState;
  /** Remaining time per side, as of when the server sent this message. */
  readonly clocks: Readonly<Record<Colour, number>>;
  /** Whether both players have joined. */
  readonly started: boolean;
  /**
   * Whose clock is running, or null when none is: before both sides have made
   * their (untimed) first move, and after the end.
   */
  readonly running: Colour | null;
  /** Time left for the side to move to make their first move, or null once both have. */
  readonly abortIn: number | null;
  /** Which players currently have a live connection. */
  readonly connected: Readonly<Record<Colour, boolean>>;
  readonly result: GameResult | null;
  /** Every position so far (positionKey), for the no-repetition rule. */
  readonly seen: readonly string[];
  /** Which players have asked for a rematch since the game ended. */
  readonly rematch: Readonly<Record<Colour, boolean>>;
}

export type ServerMessage =
  | ({ t: 'state' } & RoomView)
  | { t: 'error'; message: string };
