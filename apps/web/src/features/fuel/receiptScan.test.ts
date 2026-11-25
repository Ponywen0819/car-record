import { describe, expect, it, vi } from 'vitest';
import { scanFuelReceipt } from './receiptScan';

const utf8 = (s: string) => new TextEncoder().encode(s);
const HEADER = 'QZ87654321' + '1141118' + 'A1b2' + '00000000' + '000003B8' + '00000000' + '03244509' + 'abcdefghijklmnopqrstuv==';
const photo = new Blob(['jpeg'], { type: 'image/jpeg' });

describe('scanFuelReceipt', () => {
  it('decodes the photo and returns the fuel fill', async () => {
    const decode = vi.fn(async () => [utf8(`${HEADER}:**********:1:1:1:95無鉛汽油:30.12:31.6`)]);
    const res = await scanFuelReceipt(photo, decode);
    expect(decode).toHaveBeenCalledWith(photo);
    expect(res).toEqual({
      ok: true,
      fill: { invoiceNumber: 'QZ87654321', date: '2025-11-18', amount: 30.12, unitPrice: 31.6, total: 952, grade: '95' },
    });
  });

  it('reports no-qr when the photo has no QR code', async () => {
    const res = await scanFuelReceipt(photo, async () => []);
    expect(res).toMatchObject({ ok: false, reason: 'no-qr' });
    expect(res.ok ? '' : res.message).toMatch(/QR/);
  });

  it('reports not-einvoice when the QR codes are not an e-invoice', async () => {
    const res = await scanFuelReceipt(photo, async () => [utf8('https://example.com')]);
    expect(res).toMatchObject({ ok: false, reason: 'not-einvoice' });
  });

  it('reports no-fuel when the invoice has no fuel item', async () => {
    const res = await scanFuelReceipt(photo, async () => [utf8(`${HEADER}:**********:1:1:1:礦泉水:1:20`)]);
    expect(res).toMatchObject({ ok: false, reason: 'no-fuel' });
  });

  it('reports error when the photo cannot be read', async () => {
    const res = await scanFuelReceipt(photo, async () => {
      throw new Error('wasm failed');
    });
    expect(res).toMatchObject({ ok: false, reason: 'error' });
  });

  it('gives every failure a Chinese message for the form', async () => {
    for (const decode of [async () => [], async () => [utf8('x')]]) {
      const res = await scanFuelReceipt(photo, decode);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toMatch(/[一-鿿]/);
    }
  });
});
