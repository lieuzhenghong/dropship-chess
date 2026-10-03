// Text for the status line and clocks. Pure, so it can be unit tested.

import { type Colour, type GameState, other } from '../engine/rules';
import type { GameResult, RoomView } from '../protocol';

export const COLOUR_NAMES: Record<Colour, string> = { w: 'White', b: 'Black' };

/** m:ss, with tenths in the last ten seconds. */
export function formatClock(ms: number): string {
  const t = Math.max(0, ms);
  if (t < 10_000) return `0:0${(t / 1000).toFixed(1)}`;
  const s = Math.ceil(t / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Whose move it is in a started, unfinished online game. */
export const onlineTurn = (v: RoomView | null | undefined): Colour | null =>
  v && v.started && !v.result ? v.game.turn : null;

const score = (res: GameResult) => (res.winner === 'w' ? '1–0' : '0–1');

/** Status for an online game. `checked` lists the colours whose King is attacked. */
export function onlineStatus(view: RoomView | null, checked: readonly Colour[]): string {
  if (!view) return 'Connecting…';
  const { you, result: res } = view;
  if (res?.reason === 'aborted') return 'Game aborted: a first move wasn’t made in time.';
  if (res?.winner) {
    const how = res.reason === 'time' ? 'on time'
      : res.reason === 'resign' ? 'by resignation'
      : res.reason === 'stuck' ? '(no legal moves left)' : 'by capturing the King';
    return you
      ? `${res.winner === you ? 'You win' : 'You lose'} ${how}, ${score(res)}`
      : `${COLOUR_NAMES[res.winner]} wins ${how}, ${score(res)}`;
  }
  if (!view.started) return 'Waiting for your opponent to open the link…';
  if (!you) return `Watching · ${COLOUR_NAMES[view.game.turn]} to move`;
  const turn = onlineTurn(view);
  return `${turn === you ? 'Your move' : 'Opponent’s move'}${
    turn === you && checked.includes(you) ? ' · your King is under attack' : ''
  }${!view.connected[other(you)] ? ' · opponent offline' : ''}`;
}

/**
 * Status for a game on this device. `aiColour` is the computer's colour, or
 * null for two players.
 */
export function localStatus(s: GameState, aiColour: Colour | null, checked: readonly Colour[]): string {
  if (s.winner) {
    const res = { winner: s.winner, reason: s.winBy ?? 'king' } as const;
    if (aiColour !== null) {
      return `${s.winner === aiColour ? 'Computer wins' : 'You win'}${
        s.winBy === 'stuck' ? ' (no legal moves left)' : ''}, ${score(res)}`;
    }
    return `${COLOUR_NAMES[s.winner]} wins${
      s.winBy === 'stuck' ? `: ${COLOUR_NAMES[other(s.winner)]} has no legal moves` : ''}, ${score(res)}`;
  }
  if (aiColour === s.turn) return 'Computer is thinking…';
  return `${aiColour === null ? `${COLOUR_NAMES[s.turn]} to move` : 'Your move'}${
    checked.includes(s.turn) ? ' · your King is under attack' : ''
  }`;
}
