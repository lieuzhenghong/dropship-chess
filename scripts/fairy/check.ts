// Checks that dropship.ini matches the real rules: plays random games with
// the app's rules engine and compares its legal moves with Fairy-Stockfish's
// at every position.
//
//   npm run fairy:check -- [games=200]

import { allMoves, applyMove, initialState, randomBackRank } from '../../src/engine/rules';
import { Fairy, toUci } from './engine';

const games = Number(process.argv[2] ?? 200);
const engine = new Fairy();
let positions = 0;
let mismatches = 0;

for (let g = 0; g < games; g++) {
  const start = initialState(randomBackRank());
  let s = start;
  const moves: string[] = [];
  for (let ply = 0; ply < 150; ply++) {
    const ours = allMoves(s).map((m) => toUci(s, m)).sort();
    const theirs = (await engine.legalMoves(start, moves)).sort();
    positions++;
    if (ours.join() !== theirs.join()) {
      mismatches++;
      if (mismatches <= 5) {
        console.log(`game ${g} ply ${ply} after: ${moves.join(' ')}`);
        console.log(`  only ours:   ${ours.filter((m) => !theirs.includes(m)).join(' ')}`);
        console.log(`  only engine: ${theirs.filter((m) => !ours.includes(m)).join(' ')}`);
      }
      break;
    }
    if (s.winner) break;
    const legal = allMoves(s);
    const move = legal[Math.floor(Math.random() * legal.length)];
    moves.push(toUci(s, move));
    s = applyMove(s, move);
  }
}
engine.close();
console.log(`${positions} positions in ${games} games, ${mismatches} games with a mismatch`);
process.exit(mismatches ? 1 : 0);
