#!/usr/bin/env node
// Builds the app icons (SVG + PNGs) from the original black-knight sprite.
// Usage: node scripts/make-icons.mjs   (run after extract-sprites.mjs)

import { writeFileSync, readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pub = resolve(here, '../public');
const data = readFileSync(resolve(here, '../src/sprites/data.ts'), 'utf8');
const rows = data.match(/bN: \[([^\]]+)\]/)[1].match(/'([0-9a-f]{8})'/g).map((s) => parseInt(s.slice(1, -1), 16));

const LIGHT = [0xe8, 0xe2, 0xc8];
const DARK = [0x3d, 0x4a, 0x3c];
// 32px sprite centred on a 48-unit canvas keeps it inside the maskable safe zone.
const GRID = 48;
const OFF = 8;
const ink = (x, y) => {
  const sx = x - OFF;
  const sy = y - OFF;
  return sx >= 0 && sx < 32 && sy >= 0 && sy < 32 && ((rows[sy] >>> sx) & 1) === 1;
};

// SVG
let rects = '';
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 32; x++) {
    if ((rows[y] >>> x) & 1) rects += `<rect x="${x + OFF}" y="${y + OFF}" width="1" height="1"/>`;
  }
}
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
writeFileSync(
  resolve(pub, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" shape-rendering="crispEdges">` +
    `<rect width="${GRID}" height="${GRID}" fill="${hex(LIGHT)}"/><g fill="${hex(DARK)}">${rects}</g></svg>\n`,
);

// PNG (minimal encoder: 8-bit RGB, no interlace)
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, body) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
};
function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const c = ink(Math.floor((x * GRID) / size), Math.floor((y * GRID) / size)) ? DARK : LIGHT;
      raw.set(c, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
for (const size of [192, 512]) writeFileSync(resolve(pub, `icon-${size}.png`), png(size));
console.log('wrote public/icon.svg, icon-192.png, icon-512.png');
