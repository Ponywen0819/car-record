import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

export interface QrReaderOverrides {
  wasmBinary?: ArrayBuffer;
}

export type QrImageSource = Blob | { data: Uint8ClampedArray; width: number; height: number };

const locateSelfHostedWasm = (path: string, prefix: string): string =>
  path.endsWith('.wasm') ? wasmUrl : prefix + path;

let currentOverrides: { locateFile: typeof locateSelfHostedWasm; wasmBinary?: ArrayBuffer } = {
  locateFile: locateSelfHostedWasm,
};
let needsPrepare = true;

/**
 * Configure WASM overrides (e.g. an in-memory wasmBinary in Node tests).
 * Deferred until the first decodeQrCodes() call so zxing-wasm stays lazy-loaded.
 */
export function prepareQrReader(overrides?: QrReaderOverrides): void {
  currentOverrides = overrides?.wasmBinary
    ? { locateFile: locateSelfHostedWasm, wasmBinary: overrides.wasmBinary }
    : { locateFile: locateSelfHostedWasm };
  needsPrepare = true;
}

/**
 * Decode all QR codes in an image and return each symbol's raw byte payload
 * (preserving Big5 / binary bytes without UTF-8 text conversion).
 */
export async function decodeQrCodes(image: QrImageSource): Promise<Uint8Array[]> {
  const { prepareZXingModule, readBarcodes } = await import('zxing-wasm/reader');
  if (needsPrepare) {
    prepareZXingModule({ overrides: currentOverrides, fireImmediately: false });
    needsPrepare = false;
  }
  const results = await readBarcodes(image as Blob | ImageData, {
    formats: ['QRCode'],
    tryHarder: true,
    maxNumberOfSymbols: 4,
  });
  return results.filter((r) => r.isValid).map((r) => new Uint8Array(r.bytes));
}
