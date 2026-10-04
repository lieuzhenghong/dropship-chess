// Talks UCI to a local Fairy-Stockfish build (scripts/fairy/setup.sh) set up
// for Dropship Chess (dropship.ini), and converts moves both ways.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  col,
  type GameState,
  HAND_KINDS,
  type HandKind,
  type Move,
  row,
  SIZE,
  square,
} from '../../src/engine/rules';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const BINARY = `${ROOT}node_modules/.cache/fairy-stockfish`;
const VARIANT_FILE = `${ROOT}scripts/fairy/dropship.ini`;

const sqName = (sq: number) => `${'abcdef'[col(sq)]}${SIZE - row(sq)}`;
const parseSq = (s: string) => square(SIZE - Number(s[1]), s.charCodeAt(0) - 97);

export function toUci(state: GameState, move: Move): string {
  if (move.type === 'drop') return `${move.kind}@${sqName(move.to)}`;
  const piece = state.board[move.from]!;
  const promotes = piece.kind === 'P' && row(move.to) === (piece.colour === 'w' ? 0 : SIZE - 1);
  return `${sqName(move.from)}${sqName(move.to)}${promotes ? 'q' : ''}`;
}

export function fromUci(uci: string): Move {
  if (uci[1] === '@') return { type: 'drop', kind: uci[0] as HandKind, to: parseSq(uci.slice(2, 4)) };
  return { type: 'move', from: parseSq(uci.slice(0, 2)), to: parseSq(uci.slice(2, 4)) };
}

/** FEN of a position, with hands and promoted pieces (marked ~). */
export function toFen(state: GameState): string {
  const ranks: string[] = [];
  for (let r = 0; r < SIZE; r++) {
    let line = '';
    let empty = 0;
    for (let c = 0; c < SIZE; c++) {
      const p = state.board[square(r, c)];
      if (!p) {
        empty++;
        continue;
      }
      if (empty) line += empty;
      empty = 0;
      line += (p.colour === 'w' ? p.kind : p.kind.toLowerCase()) + (p.promoted ? '~' : '');
    }
    ranks.push(line + (empty || ''));
  }
  let hand = '';
  for (const c of ['w', 'b'] as const) {
    for (const k of HAND_KINDS) hand += (c === 'w' ? k : k.toLowerCase()).repeat(state.hands[c][k]);
  }
  return `${ranks.join('/')}[${hand}] ${state.turn} - - 0 1`;
}

export class Fairy {
  private proc: ChildProcessWithoutNullStreams;
  private waiting: ((line: string) => boolean) | null = null;
  private resolveWait: (() => void) | null = null;

  constructor() {
    if (!existsSync(BINARY)) {
      throw new Error(`No engine at ${BINARY}. Build it with: sh scripts/fairy/setup.sh`);
    }
    this.proc = spawn(BINARY, [], { stdio: 'pipe' });
    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      if (this.waiting?.(line)) {
        this.waiting = null;
        this.resolveWait?.();
      }
    });
    this.send('uci');
    this.send(`setoption name VariantPath value ${VARIANT_FILE}`);
    this.send('setoption name UCI_Variant value dropship');
  }

  private send(cmd: string) {
    this.proc.stdin.write(`${cmd}\n`);
  }

  /** Sends `cmd`, feeding each output line to `onLine` until it returns true. */
  private request(cmd: string, onLine: (line: string) => boolean): Promise<void> {
    return new Promise((resolve) => {
      this.waiting = onLine;
      this.resolveWait = resolve;
      this.send(cmd);
    });
  }

  private async position(start: GameState, moves: readonly string[]) {
    this.send(`position fen ${toFen(start)}${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
    await this.request('isready', (l) => l === 'readyok');
  }

  /** The engine's move after `moves` from `start`, searching for `movetime` ms. */
  async bestMove(start: GameState, moves: readonly string[], movetime: number): Promise<string | null> {
    await this.position(start, moves);
    let best: string | null = null;
    await this.request(`go movetime ${movetime}`, (l) => {
      if (!l.startsWith('bestmove')) return false;
      const m = l.split(' ')[1];
      best = m && m !== '(none)' ? m : null;
      return true;
    });
    return best;
  }

  /** Every legal move after `moves` from `start`, in UCI notation. */
  async legalMoves(start: GameState, moves: readonly string[]): Promise<string[]> {
    await this.position(start, moves);
    const out: string[] = [];
    await this.request('go perft 1', (l) => {
      const m = /^(\S+): 1$/.exec(l);
      if (m) out.push(m[1]);
      return l.startsWith('Nodes searched');
    });
    return out;
  }

  newGame() {
    this.send('ucinewgame');
  }

  close() {
    this.send('quit');
  }
}
