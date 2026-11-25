import { describe, expect, it, vi } from 'vitest';
import { scanReceipt } from './receiptScan';

const utf8 = (s: string) => new TextEncoder().encode(s);
// total 0x726 = 1830
const HEADER = 'MK13572468' + '1141120' + 'Z9z9' + '00000000' + '00000726' + '00000000' + '24681357' + 'abcdefghijklmnopqrstuv==';
const photo = new Blob(['jpeg'], { type: 'image/jpeg' });

describe('scanReceipt (maintenance / other expenses)', () => {
  it('decodes the photo and returns date, total and the item note', async () => {
    const decode = vi.fn(async () => [utf8(`${HEADER}:**********:2:2:1:機油芯:1:250:工資:1:300`)]);
    const res = await scanReceipt(photo, decode);
    expect(decode).toHaveBeenCalledWith(photo);
    expect(res).toEqual({
      ok: true,
      fill: { invoiceNumber: 'MK13572468', date: '2025-11-20', total: 1830, note: '機油芯 ×1 250元、工資 ×1 300元' },
    });
  });

  it('accepts any e-invoice, fuel included', async () => {
    const res = await scanReceipt(photo, async () => [utf8(`${HEADER}:**********:1:1:1:95無鉛汽油:30:31`)]);
    expect(res.ok).toBe(true);
  });

  it('reports no-qr when the photo has no QR code', async () => {
    expect(await scanReceipt(photo, async () => [])).toMatchObject({ ok: false, reason: 'no-qr' });
  });

  it('reports not-einvoice for other QR codes', async () => {
    expect(await scanReceipt(photo, async () => [utf8('https://example.com')])).toMatchObject({ ok: false, reason: 'not-einvoice' });
  });

  it('reports error when the photo cannot be read', async () => {
    const res = await scanReceipt(photo, async () => {
      throw new Error('wasm failed');
    });
    expect(res).toMatchObject({ ok: false, reason: 'error' });
    if (!res.ok) expect(res.message).toMatch(/[一-鿿]/);
  });
});
