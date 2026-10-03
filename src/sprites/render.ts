import type { Colour, Kind } from '../engine/rules';
import { SPRITES } from './data';

export interface Palette {
  /** Piece outlines and solid areas ("black" pixels on the Hack screen). */
  readonly ink: string;
  /** Enclosed "white" pixels inside a piece. */
  readonly fill: string;
}

const N = 32;
const cache = new Map<string, string>();

/**
 * Splits a sprite into ink pixels and enclosed fill pixels. Unset pixels
 * reachable from the edge are background and stay transparent. The original
 * outlines are closed, so a 4-connected flood fill separates them cleanly.
 */
export function spriteMask(key: string): { ink: boolean[]; fill: boolean[] } {
  const rows = SPRITES[key];
  const ink = new Array<boolean>(N * N);
  rows.forEach((hex, y) => {
    const bits = parseInt(hex, 16);
    for (let x = 0; x < N; x++) ink[y * N + x] = ((bits >>> x) & 1) === 1;
  });
  const outside = new Array<boolean>(N * N).fill(false);
  const stack: number[] = [];
  for (let i = 0; i < N; i++) stack.push(i, (N - 1) * N + i, i * N, i * N + N - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (outside[i] || ink[i]) continue;
    outside[i] = true;
    const x = i % N;
    if (x > 0) stack.push(i - 1);
    if (x < N - 1) stack.push(i + 1);
    if (i >= N) stack.push(i - N);
    if (i < N * (N - 1)) stack.push(i + N);
  }
  return { ink, fill: ink.map((v, i) => !v && !outside[i]) };
}

/** Renders one of the original 32x32 piece sprites to a transparent PNG data URL. */
export function spriteUrl(colour: Colour, kind: Kind, palette: Palette): string {
  const key = `${colour}${kind}`;
  const cacheKey = `${key}|${palette.ink}|${palette.fill}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const { ink, fill } = spriteMask(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < N * N; i++) {
    if (!ink[i] && !fill[i]) continue;
    ctx.fillStyle = ink[i] ? palette.ink : palette.fill;
    ctx.fillRect(i % N, Math.floor(i / N), 1, 1);
  }
  const url = canvas.toDataURL('image/png');
  cache.set(cacheKey, url);
  return url;
}
