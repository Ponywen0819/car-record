// @vitest-environment node
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { prepareZXingModule as prepareWriter, writeBarcode } from 'zxing-wasm/full';
import { decodeQrCodes, prepareQrReader } from '../qr';

/**
 * decodeQrCodes() must return the RAW bytes of every QR code in the picture: Taiwan e-invoices
 * carry Big5 text that the library's own text decoding garbles, and a receipt has two codes side
 * by side. Codes are generated with zxing-wasm's writer and laid out into one RGBA image.
 */

const require = createRequire(import.meta.url);
const toArrayBuffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

beforeAll(async () => {
  await prepareWriter({
    overrides: { wasmBinary: toArrayBuffer(fs.readFileSync(require.resolve('zxing-wasm/full/zxing_full.wasm'))) },
    fireImmediately: true,
  });
  prepareQrReader({ wasmBinary: toArrayBuffer(fs.readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'))) });
});

interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Render QR symbols left-to-right on a white RGBA canvas (scale px per module, 4-module quiet zone). */
async function receiptImage(payloads: Uint8Array[], scale = 4): Promise<Rgba> {
  const symbols = [];
  for (const p of payloads) {
    const res = await writeBarcode(p, { format: 'QRCode', ecLevel: 'L' });
    if (res.error) throw new Error(res.error);
    symbols.push(res.symbol);
  }
  const quiet = 4 * scale;
  const width = symbols.reduce((w, s) => w + s.width * scale + quiet, quiet);
  const height = Math.max(...symbols.map((s) => s.height)) * scale + 2 * quiet;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  let x0 = quiet;
  for (const s of symbols) {
    for (let y = 0; y < s.height * scale; y++) {
      for (let x = 0; x < s.width * scale; x++) {
        const dark = s.data[Math.floor(y / scale) * s.width + Math.floor(x / scale)] === 0;
        if (!dark) continue;
        const i = ((quiet + y) * width + x0 + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
    x0 += s.width * scale + quiet;
  }
  return { data, width, height };
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('decodeQrCodes', () => {
  it('returns the raw bytes of both codes on a receipt, including Big5 text', async () => {
    const left = new Uint8Array([
      ...new TextEncoder().encode('AB112233441020523999900000144000001540000000001234567ydXZt4LAN1UHN/j1juVcRA==:**********:3:3:0:'),
      0xb0, 0xae, 0xb9, 0x71, 0xa6, 0xc0, 0x3a, 0x31, 0x3a, 0x31, 0x30, 0x35, 0x3a, // Big5 bytes then ":1:105:"
    ]);
    const right = new TextEncoder().encode('**OjE6MTA1OuWPo+e9qToxOjIxMDrniZvlpbY6MToyNQ==');
    const codes = await decodeQrCodes(await receiptImage([left, right]));
    expect(codes.map(hex).sort()).toEqual([hex(left), hex(right)].sort());
  });

  it('returns an empty list when the picture has no QR code', async () => {
    const width = 64;
    const height = 64;
    expect(await decodeQrCodes({ data: new Uint8ClampedArray(width * height * 4).fill(255), width, height })).toEqual([]);
  });
});
