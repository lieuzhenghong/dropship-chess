// Cloudflare Worker entry point plus one Durable Object per game.
//
//   GET /game/<id>  (WebSocket upgrade) → the Game object named <id>
//
// The object stores a `Room` (see room.ts) and uses the WebSocket Hibernation
// API, so it can be evicted from memory between moves without dropping the
// players' connections.

import { DurableObject } from 'cloudflare:workers';
import type { Colour } from '../../src/engine/rules';
import type { ClientMessage, ServerMessage } from '../../src/protocol';
import { checkFlag, clocksAt, join, move, newRoom, type Room, runningClock } from './room';

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
    const before = await this.load();
    let room = checkFlag(before, now);
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
        break; // checkFlag above already did the work
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
    this.broadcast(await this.load(), Date.now(), ws);
  }

  private async load(): Promise<Room> {
    return (await this.ctx.storage.get<Room>('room')) ?? newRoom();
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
    sockets.forEach((s, i) =>
      this.send(s, {
        t: 'state',
        you: seats[i],
        game: room.game,
        clocks,
        running: runningClock(room),
        connected,
        result: room.result,
      }),
    );
  }
}
