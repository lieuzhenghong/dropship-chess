// Client side of online play: one WebSocket to the game server, reconnecting
// automatically (mobile browsers drop sockets whenever the screen locks).

import type { Move } from './engine/rules';
import type { ClientMessage, RoomView, ServerMessage } from './protocol';
import type { KeyValueStore } from './storage';

/** Game server base URL (ws:// or wss://), set at build time. Empty disables online play. */
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? '';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

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

/** The player's secret for a game, created on first visit and reused on reconnect. */
function playerToken(store: KeyValueStore, gameId: string): string {
  const key = `dropship-chess:online:${gameId}`;
  let token = store.get(key);
  if (!token) {
    token = randomId(24);
    store.set(key, token);
  }
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
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
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
