// Plays two computer opponents against each other and reports the score, so
// AI changes can be measured rather than guessed at.
//
//   npm run ai:match -- <botA> <botB> [pairs=100] [timeMs=50]
//
// Bots:
//   random    any legal move, uniformly
//   baseline  the original fixed 3-ply, material-only AI (scripts/ai-baseline.ts)
//   current   the app's AI: iterative deepening within timeMs per move
//   q         current + quiescence search
//   ks        current + king safety in the evaluation
//   qks       current + both
//
// Each pair plays one shuffled start twice with colours swapped, so neither
// side benefits from a lucky position or from moving first. Games reaching
// MAX_PLIES are scored as draws.

import { chooseMove, type SearchOptions } from '../src/engine/ai';
import { allMoves, applyMove, type Colour, type GameState, initialState, type Move, randomBackRank } from '../src/engine/rules';
import { chooseMove as baselineMove } from './ai-baseline';

const [nameA = 'current', nameB = 'baseline'] = process.argv.slice(2, 4);
const pairs = Number(process.argv[4] ?? 100);
const timeMs = Number(process.argv[5] ?? 50);
const MAX_PLIES = 200;

interface Bot {
  move(s: GameState, stats: { depth: number }): Move | null;
  /** Whether it reports a search depth. */
  searches: boolean;
}

const search = (extra: SearchOptions): Bot => ({
  move: (s, stats) => chooseMove(s, { timeMs, ...extra, stats }),
  searches: true,
});

const BOTS: Record<string, Bot> = {
  random: {
    move: (s) => {
      const moves = allMoves(s);
      return moves.length ? moves[Math.floor(Math.random() * moves.length)] : null;
    },
    searches: false,
  },
  baseline: { move: (s) => baselineMove(s), searches: false },
  current: search({}),
  q: search({ quiescence: true }),
  ks: search({ kingSafety: true }),
  qks: search({ quiescence: true, kingSafety: true }),
};

const bots = { a: BOTS[nameA], b: BOTS[nameB] };
if (!bots.a || !bots.b) {
  console.error(`Unknown bot. Choose from: ${Object.keys(BOTS).join(', ')}`);
  process.exit(1);
}

type Side = 'a' | 'b';
const stats = {
  a: { ms: 0, moves: 0, depth: 0 },
  b: { ms: 0, moves: 0, depth: 0 },
};

function play(start: GameState, aColour: Colour): { winner: Side | null; plies: number } {
  let s = start;
  let plies = 0;
  while (!s.winner && plies < MAX_PLIES) {
    const side: Side = s.turn === aColour ? 'a' : 'b';
    const info = { depth: 0 };
    const t0 = performance.now();
    const move = bots[side].move(s, info);
    stats[side].ms += performance.now() - t0;
    stats[side].moves++;
    stats[side].depth += info.depth;
    if (!move) break;
    s = applyMove(s, move);
    plies++;
  }
  if (!s.winner) return { winner: null, plies };
  return { winner: s.winner === aColour ? 'a' : 'b', plies };
}

const tally = { a: 0, b: 0, draw: 0 };
let totalPlies = 0;
const t0 = Date.now();
for (let i = 0; i < pairs; i++) {
  const start = initialState(randomBackRank());
  for (const colour of ['w', 'b'] as const) {
    const { winner, plies } = play(start, colour);
    tally[winner ?? 'draw']++;
    totalPlies += plies;
  }
  if ((i + 1) % 10 === 0) process.stderr.write(`  ${nameA} vs ${nameB}: ${i + 1}/${pairs} pairs\n`);
}

const games = pairs * 2;
const score = (tally.a + tally.draw / 2) / games;
// 95% interval for the score, normal approximation.
const margin = 1.96 * Math.sqrt((score * (1 - score)) / games);
const describe = (side: Side, name: string) => {
  const { ms, moves, depth } = stats[side];
  const n = Math.max(1, moves);
  return `${name} ${(ms / n).toFixed(1)} ms/move${bots[side].searches ? `, avg depth ${(depth / n).toFixed(1)}` : ''}`;
};
console.log(`${nameA} vs ${nameB}: ${games} games (${pairs} starts × both colours), search budget ${timeMs} ms/move`);
console.log(`${nameA} wins ${tally.a}, ${nameB} wins ${tally.b}, draws ${tally.draw}`);
console.log(`${nameA} score: ${(score * 100).toFixed(1)}% ± ${(margin * 100).toFixed(1)}% (95% CI)`);
console.log(`${describe('a', nameA)}; ${describe('b', nameB)}; avg game ${(totalPlies / games).toFixed(0)} plies`);
console.log(`took ${((Date.now() - t0) / 1000).toFixed(0)} s`);
