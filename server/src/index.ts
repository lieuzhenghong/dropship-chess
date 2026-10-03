// Cloudflare Worker entry point plus one Durable Object per game.
//
//   GET /game/<id>  (WebSocket upgrade) → the Game object named <id>
//
// The object stores a `Room` (see room.ts) and uses the WebSocket Hibernation
// API, so it can be evicted from memory between moves without dropping the
// players' connections. A single alarm wakes it for whatever comes next: a
// first-move deadline, a clock running out, or deleting a game that never got
// going. Games with real moves are kept.

import { DurableObject } from 'cloudflare:workers';
import type { Colour } from '../../src/engine/rules';
import { CLOSE_GAME_EXPIRED, type ClientMessage, type ServerMessage } from '../../src/protocol';
import {
  checkTimeouts,
  clocksAt,
  expiresAt,
  isStarted,
  join,
  move,
  newRoom,
  nextWake,
  type Room,
  runningClock,
  upgradeRoom,
} from './room';

interface Env {
  GAME: DurableObjectNamespace<Game>;
}

interface Attachment {
  seat: Colour | null;
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
    server.serializeAttachment({ seat: null } satisfies Attachment);
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
    const before = await this.load(now);
    let room = checkTimeouts(before, now);
    const { seat } = ws.deserializeAttachment() as Attachment;

    switch (msg.t) {
      case 'join': {
        if (typeof msg.token !== 'string' || msg.token.length < 8) {
          return this.send(ws, { t: 'error', message: 'Bad token.' });
        }
        const joined = join(room, msg.token, now);
        room = joined.room;
        ws.serializeAttachment({ seat: joined.seat } satisfies Attachment);
        break;
      }
      case 'move': {
        const out = move(room, seat, msg.move, now);
        room = out.room;
        if (out.error) this.send(ws, { t: 'error', message: out.error });
        break;
      }
      case 'flag':
        break; // checkTimeouts above already did the work
      default:
        return this.send(ws, { t: 'error', message: 'Unknown message.' });
    }

    if (room !== before) await this.save(room);
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
    if (stored) this.broadcast(upgradeRoom(stored, Date.now()), Date.now(), ws);
  }

  /** Wakes for a first-move deadline, a clock running out, or deletion. */
  async alarm(): Promise<void> {
    const stored = await this.ctx.storage.get<Room>('room');
    if (!stored) return;
    const now = Date.now();
    const room = upgradeRoom(stored, now);
    const expiry = expiresAt(room);
    if (expiry !== null && now >= expiry) {
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(CLOSE_GAME_EXPIRED, 'Game expired');
        } catch {
          // Already closed.
        }
      }
      await this.ctx.storage.deleteAll();
      return;
    }
    const next = checkTimeouts(room, now);
    if (next !== room) {
      await this.save(next);
      this.broadcast(next, now);
    } else {
      await this.schedule(room);
    }
  }

  private async load(now: number): Promise<Room> {
    const stored = await this.ctx.storage.get<Room>('room');
    return stored ? upgradeRoom(stored, now) : newRoom(now);
  }

  private async save(room: Room): Promise<void> {
    await this.ctx.storage.put('room', room);
    await this.schedule(room);
  }

  private async schedule(room: Room): Promise<void> {
    const wake = nextWake(room);
    if (wake === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(wake);
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
    const seats = sockets.map((s) => (s.deserializeAttachment() as Attachment).seat);
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
      }),
    );
  }
}
