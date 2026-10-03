// Persistence behind a tiny key-value interface so a native wrapper (e.g.
// Capacitor Preferences) can replace localStorage without touching the UI.

import { type GameState, HAND_KINDS, SQUARES } from './engine/rules';

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const localStore: KeyValueStore = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private mode / storage disabled: the game still works, just unsaved.
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // As above.
    }
  },
};

const GAME_KEY = 'dropship-chess:game:v1';

/** Undo history; the last entry is the current position. */
export type History = readonly GameState[];

function looksLikeState(s: unknown): s is GameState {
  if (!s || typeof s !== 'object') return false;
  const g = s as Record<string, unknown>;
  const hands = g.hands as Record<string, Record<string, unknown>> | undefined;
  return (
    Array.isArray(g.board) &&
    g.board.length === SQUARES &&
    (g.turn === 'w' || g.turn === 'b') &&
    !!hands &&
    (['w', 'b'] as const).every(
      (c) => hands[c] && HAND_KINDS.every((k) => typeof hands[c][k] === 'number'),
    )
  );
}

export function loadHistory(store: KeyValueStore): History | null {
  const raw = store.get(GAME_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(looksLikeState)) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return null;
}

export function saveHistory(store: KeyValueStore, history: History): void {
  store.set(GAME_KEY, JSON.stringify(history));
}
