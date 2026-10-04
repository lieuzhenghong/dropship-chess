// Evaluates the starting position of every distinct back rank with
// Fairy-Stockfish and prints those at or above a threshold for White: the
// candidates for EXCLUDED_BACK_RANKS in src/engine/rules.ts.
//
//   npm run fairy:eval-starts -- [movetimeMs=2000] [threshold=100]
//
// Takes about 12 minutes at the default 2 s per position. Scores vary a
// little between runs, so check borderline positions with self-play.

import { initialState, type Kind } from '../../src/engine/rules';
import { Fairy } from './engine';

const movetime = Number(process.argv[2] ?? 2000);
const threshold = Number(process.argv[3] ?? 100);

const ranks = new Set<string>();
(function permute(a: Kind[], k: number) {
  if (k === a.length) return void ranks.add(a.join(''));
  for (let i = k; i < a.length; i++) {
    [a[k], a[i]] = [a[i], a[k]];
    permute(a, k + 1);
    [a[k], a[i]] = [a[i], a[k]];
  }
})(['R', 'R', 'Q', 'K', 'N', 'B'], 0);

const engine = new Fairy();
const scores: { rank: string; score: number | string }[] = [];
for (const rank of [...ranks].sort()) {
  engine.newGame();
  scores.push({ rank, score: await engine.evaluate(initialState([...rank] as Kind[]), movetime) });
  if (scores.length % 30 === 0) process.stderr.write(`  ${scores.length}/${ranks.size}\n`);
}
engine.close();

// A mate score for White counts as above any threshold.
const value = (s: number | string) =>
  typeof s === 'number' ? s : Number(s.split(' ')[1]) > 0 ? Infinity : -Infinity;
scores.sort((a, b) => value(b.score) - value(a.score));
for (const { rank, score } of scores) console.log(`${rank} ${score}`);
const excluded = scores.filter((s) => value(s.score) >= threshold).map((s) => s.rank).sort();
console.log(`\n${excluded.length} at or above +${threshold}:\n${excluded.map((r) => `'${r}'`).join(', ')}`);
