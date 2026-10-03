// Client side of online play: one WebSocket to the game server, reconnecting
// automatically (mobile browsers drop sockets whenever the screen locks).

import type { Move } from './engine/rules';
import { CLOSE_GAME_EXPIRED, type ClientMessage, type RoomView, type ServerMessage } from './protocol';
import type { KeyValueStore } from './storage';

/** Game server base URL (ws:// or wss://), set at build time. Empty disables online play. */
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? '';

/** 'expired' means the server has deleted the game; we stop reconnecting. */
export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'expired';

export interface OnlineGame {
  sendMove(move: Move): void;
  claimFlag(): void;
  close(): void;
}

export interface OnlineHandlers {
  /** A fresh snapshot from the server; `receivedAt` is local time, for clock display. */
  onState(view: RoomView, receivedAt: number): void;
  onStatus(status: ConnectionStatus): void;
  onError(message: string): void;
}

function randomId(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export const newGameId = (): string => randomId(10);

const TOKEN_PREFIX = 'dropship-chess:online:';
const TOKEN_INDEX = 'dropship-chess:online-games';
/** How many games' tokens to keep; older ones can no longer be rejoined. */
const MAX_TOKENS = 20;

/** The player's secret for a game, created on first visit and reused on reconnect. */
function playerToken(store: KeyValueStore, gameId: string): string {
  let token = store.get(TOKEN_PREFIX + gameId);
  if (!token) {
    token = randomId(24);
    store.set(TOKEN_PREFIX + gameId, token);
  }
  // Keep a most-recent-last list of games and forget the oldest tokens.
  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(store.get(TOKEN_INDEX) ?? '[]');
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    // Start a fresh list.
  }
  ids = [...ids.filter((id) => id !== gameId), gameId];
  for (const old of ids.splice(0, Math.max(0, ids.length - MAX_TOKENS))) store.remove(TOKEN_PREFIX + old);
  store.set(TOKEN_INDEX, JSON.stringify(ids));
  return token;
}

export function connect(gameId: string, store: KeyValueStore, handlers: OnlineHandlers): OnlineGame {
  const token = playerToken(store, gameId);
  let ws: WebSocket | null = null;
  let closedByUs = false;
  let retryDelay = 500;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const send = (msg: ClientMessage) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const open = () => {
    clearTimeout(retryTimer);
    handlers.onStatus('connecting');
    const socket = new WebSocket(`${SERVER_URL.replace(/\/$/, '')}/game/${gameId}`);
    ws = socket;
    socket.onopen = () => {
      retryDelay = 500;
      handlers.onStatus('open');
      send({ t: 'join', token });
    };
    socket.onmessage = (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data as string);
      } catch {
        return;
      }
      if (msg.t === 'state') handlers.onState(msg, Date.now());
      else if (msg.t === 'error') handlers.onError(msg.message);
    };
    socket.onclose = (e) => {
      if (ws !== socket) return;
      ws = null;
      if (e.code === CLOSE_GAME_EXPIRED) {
        closedByUs = true;
        handlers.onStatus('expired');
        return;
      }
      handlers.onStatus('closed');
      if (closedByUs) return;
      retryTimer = setTimeout(open, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 8000);
    };
  };

  // Reconnect straight away when the page comes back to the foreground.
  const onVisible = () => {
    if (document.visibilityState === 'visible' && !ws && !closedByUs) open();
  };
  document.addEventListener('visibilitychange', onVisible);

  open();
  return {
    sendMove: (move) => send({ t: 'move', move }),
    claimFlag: () => send({ t: 'flag' }),
    close() {
      closedByUs = true;
      clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
      ws?.close();
    },
  };
}
