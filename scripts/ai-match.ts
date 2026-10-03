// Plays the current computer opponent against the original one and reports
// the score, so AI changes can be measured rather than guessed at.
//
//   npm run ai:match -- [pairs=100] [timeMs=50]
//
// Each pair plays one shuffled start twice with colours swapped, so neither
// side benefits from a lucky position or from moving first. Games reaching
// MAX_PLIES are scored as draws.

import { chooseMove } from '../src/engine/ai';
import { applyMove, type Colour, type GameState, initialState, randomBackRank } from '../src/engine/rules';
import { chooseMove as baselineMove } from './ai-baseline';

const pairs = Number(process.argv[2] ?? 100);
const timeMs = Number(process.argv[3] ?? 50);
const MAX_PLIES = 200;

type Result = 'new' | 'old' | 'draw';
const stats = { new: { ms: 0, moves: 0 }, old: { ms: 0, moves: 0 } };

function play(start: GameState, newColour: Colour): { result: Result; plies: number } {
  let s = start;
  let plies = 0;
  while (!s.winner && plies < MAX_PLIES) {
    const side = s.turn === newColour ? 'new' : 'old';
    const t0 = performance.now();
    const move = side === 'new' ? chooseMove(s, { timeMs }) : baselineMove(s);
    stats[side].ms += performance.now() - t0;
    stats[side].moves++;
    if (!move) break;
    s = applyMove(s, move);
    plies++;
  }
  if (!s.winner) return { result: 'draw', plies };
  return { result: s.winner === newColour ? 'new' : 'old', plies };
}

const tally: Record<Result, number> = { new: 0, old: 0, draw: 0 };
let totalPlies = 0;
const t0 = Date.now();
for (let i = 0; i < pairs; i++) {
  const start = initialState(randomBackRank());
  for (const colour of ['w', 'b'] as const) {
    const { result, plies } = play(start, colour);
    tally[result]++;
    totalPlies += plies;
  }
  if ((i + 1) % 10 === 0) process.stderr.write(`  ${i + 1}/${pairs} pairs\n`);
}

const games = pairs * 2;
const score = (tally.new + tally.draw / 2) / games;
// 95% interval for the score, normal approximation.
const margin = 1.96 * Math.sqrt((score * (1 - score)) / games);
const avg = (k: 'new' | 'old') => (stats[k].ms / Math.max(1, stats[k].moves)).toFixed(1);
console.log(`games: ${games} (${pairs} starts × both colours), new AI budget ${timeMs} ms/move`);
console.log(`new wins ${tally.new}, old wins ${tally.old}, draws ${tally.draw}`);
console.log(`new AI score: ${(score * 100).toFixed(1)}% ± ${(margin * 100).toFixed(1)}% (95% CI)`);
console.log(`avg time per move: new ${avg('new')} ms, old ${avg('old')} ms; avg game length ${(totalPlies / games).toFixed(0)} plies`);
console.log(`took ${((Date.now() - t0) / 1000).toFixed(0)} s`);
