#!/usr/bin/env node
/**
 * Generates the PWA / apple-touch icons as PNGs with no dependencies (node:zlib only):
 * a blue rounded-square background with a white car silhouette and a road line.
 *
 *   node scripts/gen-icons.mjs
 *
 * Writes public/icons/{apple-touch-icon-180,icon-192,icon-512}.png. The artwork is drawn
 * full-bleed with the car inside the central ~60%, so the 512 icon also works as maskable.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG_TOP = [0x35, 0x86, 0xf5];
const BG_BOTTOM = [0x1a, 0x5c, 0xd1];
const WHITE = [0xff, 0xff, 0xff];
const DARK = [0x1a, 0x3a, 0x6b];

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** rgba: Uint8Array(size*size*4) */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Drawing (in a unit square, supersampled for anti-aliasing)
// ---------------------------------------------------------------------------

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** Colour of the artwork at unit coordinates (x, y), or null for background. */
function shade(x, y) {
  // wheels (dark tyre + white hub)
  for (const cx of [0.335, 0.665]) {
    if (inCircle(x, y, cx, 0.63, 0.034)) return WHITE;
    if (inCircle(x, y, cx, 0.63, 0.075)) return DARK;
  }
  // cabin with windows
  if (inRoundRect(x, y, 0.33, 0.33, 0.67, 0.5, 0.06)) {
    const inWindow =
      inRoundRect(x, y, 0.36, 0.36, 0.49, 0.47, 0.025) || inRoundRect(x, y, 0.51, 0.36, 0.64, 0.47, 0.025);
    return inWindow ? BG_BOTTOM : WHITE;
  }
  // body
  if (inRoundRect(x, y, 0.2, 0.46, 0.8, 0.63, 0.05)) return WHITE;
  // road line
  if (y > 0.74 && y < 0.765 && x > 0.22 && x < 0.78 && Math.floor((x - 0.22) / 0.07) % 2 === 0) return WHITE;
  return null;
}

function background(y) {
  return BG_TOP.map((c, i) => Math.round(c + (BG_BOTTOM[i] - c) * y));
}

function render(size) {
  const rgba = new Uint8Array(size * size * 4);
  const ss = 4; // supersampling per axis
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          const c = shade(x, y) ?? background(y);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = ss * ss;
      const o = (py * size + px) * 4;
      rgba[o] = Math.round(r / n);
      rgba[o + 1] = Math.round(g / n);
      rgba[o + 2] = Math.round(b / n);
      rgba[o + 3] = 255; // opaque: iOS fills transparency with black
    }
  }
  return rgba;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, size] of [
  ['apple-touch-icon-180.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]) {
  const png = encodePng(size, render(size));
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`wrote public/icons/${name} (${size}x${size}, ${png.length} bytes)`);
}
