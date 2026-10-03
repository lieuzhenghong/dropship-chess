// Cloudflare Worker entry point plus one Durable Object per game.
//
//   GET /game/<id>  (WebSocket upgrade) → the Game object named <id>
//
// The object stores a `Room` (see room.ts) and uses the WebSocket Hibernation
// API, so it can be evicted from memory between moves without dropping the
// players' connections. It runs no timers: deadlines are checked whenever a
// message arrives.

import { DurableObject } from 'cloudflare:workers';
import type { ClientMessage, ServerMessage } from '../../src/protocol';
import {
  checkTimeouts,
  clocksAt,
  isStarted,
  join,
  move,
  newRoom,
  rematch,
  resign,
  type Room,
  runningClock,
  seatOf,
  upgradeRoom,
} from './room';

interface Env {
  GAME: DurableObjectNamespace<Game>;
}

/**
 * Per-socket state that survives hibernation. Storing the player's token
 * rather than their colour means seats follow the room when a rematch swaps
 * colours.
 */
interface Attachment {
  token: string | null;
}

const GAME_PATH = /^\/game\/([a-z0-9]{6,32})$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const match = new URL(request.url).pathname.match(GAME_PATH);
    if (!match) return new Response('Dropship Chess server', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    return env.GAME.get(env.GAME.idFromName(match[1])).fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class Game extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ token: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.send(ws, { t: 'error', message: 'Bad message.' });
    }
    const now = Date.now();
    const before = await this.load();
    let room = checkTimeouts(before, now);
    const seat = seatOf(room, this.tokenOf(ws));

    switch (msg.t) {
      case 'join': {
        if (typeof msg.token !== 'string' || msg.token.length < 8) {
          return this.send(ws, { t: 'error', message: 'Bad token.' });
        }
        room = join(room, msg.token, now).room;
        ws.serializeAttachment({ token: msg.token } satisfies Attachment);
        break;
      }
      case 'move':
      case 'resign':
      case 'rematch': {
        const out =
          msg.t === 'move' ? move(room, seat, msg.move, now)
          : msg.t === 'resign' ? resign(room, seat, now)
          : rematch(room, seat, now);
        room = out.room;
        if (out.error) this.send(ws, { t: 'error', message: out.error });
        break;
      }
      case 'flag':
        break; // checkTimeouts above already did the work
      default:
        return this.send(ws, { t: 'error', message: 'Unknown message.' });
    }

    if (room !== before) await this.ctx.storage.put('room', room);
    // Joins always broadcast so the opponent sees the connection indicator change.
    this.broadcast(room, now);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      // Already closed.
    }
    const stored = await this.ctx.storage.get<Room>('room');
    if (stored) this.broadcast(upgradeRoom(stored), Date.now(), ws);
  }

  private tokenOf(ws: WebSocket): string | null {
    return (ws.deserializeAttachment() as Partial<Attachment> | null)?.token ?? null;
  }

  private async load(): Promise<Room> {
    const stored = await this.ctx.storage.get<Room>('room');
    return stored ? upgradeRoom(stored) : newRoom();
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already closing; the client will resync when it reconnects.
    }
  }

  private broadcast(room: Room, now: number, closing?: WebSocket): void {
    const sockets = this.ctx.getWebSockets().filter((s) => s !== closing);
    const seats = sockets.map((s) => seatOf(room, this.tokenOf(s)));
    const connected = { w: seats.includes('w'), b: seats.includes('b') };
    const clocks = clocksAt(room, now);
    const abortIn = room.abortAt !== null && !room.result ? Math.max(0, room.abortAt - now) : null;
    sockets.forEach((s, i) =>
      this.send(s, {
        t: 'state',
        you: seats[i],
        game: room.game,
        started: isStarted(room),
        clocks,
        running: runningClock(room),
        abortIn,
        connected,
        result: room.result,
        rematch: { w: !!room.rematch.w, b: !!room.rematch.b },
      }),
    );
  }
}
