import { describe, expect, it } from 'vitest';
import { spriteMask } from './render';

describe('spriteMask', () => {
  // The white and black pawn, knight, bishop and queen share a silhouette
  // (the rook and king are drawn differently), so a pixel solid in one and
  // transparent in the other means an outline gap let the flood fill leak in.
  it.each(['P', 'N', 'B', 'Q'])('white and black %s have the same silhouette', (kind) => {
    const w = spriteMask(`w${kind}`);
    const b = spriteMask(`b${kind}`);
    const solid = (m: typeof w) => m.ink.map((v, i) => v || m.fill[i]);
    const leaks = solid(b).filter((v, i) => v && !solid(w)[i]).length;
    expect(leaks).toBe(0);
  });
});
