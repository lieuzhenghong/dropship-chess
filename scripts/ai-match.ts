// Plays two computer opponents against each other and reports the score, so
// AI changes can be measured rather than guessed at.
//
//   npm run ai:match -- <botA> <botB> [pairs=100] [timeMs=50]
//
// Bots:
//   random    any legal move, uniformly
//   baseline  the original fixed 3-ply, material-only AI (scripts/ai-baseline.ts)
//   plain     iterative deepening within timeMs per move, material-only
//   q         plain + quiescence search
//   ks        plain + king safety in the evaluation
//   qks       plain + both
//   easy, medium, hard   the app's difficulty settings (see DIFFICULTY in ai.ts)
//   fairy     Fairy-Stockfish, timeMs per move (build it: sh scripts/fairy/setup.sh)
//
// Each pair plays one shuffled start twice with colours swapped, so neither
// side benefits from a lucky position or from moving first. Games reaching
// MAX_PLIES are scored as draws.

import { chooseMove, DIFFICULTY, type SearchOptions } from '../src/engine/ai';
import { allMoves, applyMove, type Colour, type GameState, initialState, type Move, randomBackRank } from '../src/engine/rules';
import { chooseMove as baselineMove } from './ai-baseline';
import { Fairy, fromUci, toUci } from './fairy/engine';

const [nameA = 'qks', nameB = 'baseline'] = process.argv.slice(2, 4);
const pairs = Number(process.argv[4] ?? 100);
const timeMs = Number(process.argv[5] ?? 50);
const MAX_PLIES = 200;

interface Bot {
  /** `start` and `history` (the moves so far) are for bots that track the game themselves. */
  move(s: GameState, stats: { depth: number }, start: GameState, history: readonly Move[]): Move | null | Promise<Move | null>;
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
  plain: search({ quiescence: false, kingSafety: false }),
  q: search({ quiescence: true, kingSafety: false }),
  ks: search({ quiescence: false, kingSafety: true }),
  qks: search({ quiescence: true, kingSafety: true }),
  easy: search(DIFFICULTY.easy),
  medium: search(DIFFICULTY.medium),
  hard: search(DIFFICULTY.hard),
};

let fairy: Fairy | null = null;
BOTS.fairy = {
  async move(_s, _stats, start, history) {
    fairy ??= new Fairy();
    if (!history.length) fairy.newGame();
    // Replay from the start so the engine knows which queens were promoted pawns.
    const uci: string[] = [];
    let s = start;
    for (const m of history) {
      uci.push(toUci(s, m));
      s = applyMove(s, m);
    }
    const best = await fairy.bestMove(start, uci, timeMs);
    return best ? fromUci(best) : null;
  },
  searches: false,
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

async function play(start: GameState, aColour: Colour): Promise<{ winner: Side | null; plies: number }> {
  let s = start;
  let plies = 0;
  const history: Move[] = [];
  while (!s.winner && plies < MAX_PLIES) {
    const side: Side = s.turn === aColour ? 'a' : 'b';
    const info = { depth: 0 };
    const t0 = performance.now();
    const move = await bots[side].move(s, info, start, history);
    stats[side].ms += performance.now() - t0;
    stats[side].moves++;
    stats[side].depth += info.depth;
    if (!move) break;
    s = applyMove(s, move);
    history.push(move);
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
    const { winner, plies } = await play(start, colour);
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
fairy?.close();
