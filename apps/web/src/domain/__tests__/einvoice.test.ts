import { describe, expect, it } from 'vitest';
import { EInvoiceError, fuelFromInvoice, parseEInvoice, receiptFromInvoice, type EInvoice } from '../einvoice';

/**
 * Taiwan e-invoice proof (電子發票證明聯) QR codes, per the MOF spec
 * 「電子發票證明聯一維及二維條碼規格說明」Ver 1.9 (2022-05-10), chapter 貳.
 *
 * Left QR: 77 fixed chars — track no. (10) · ROC date yyyMMdd (7) · random code (4) ·
 * sales amount hex (8) · total amount hex (8) · buyer id (8) · seller id (8) · AES/Base64 (24) —
 * then ':'-separated: self-use area (10) : items recorded in the QR codes : items on the invoice :
 * encoding (0 Big5, 1 UTF-8, 2 Base64) : name:qty:unitPrice:… (continued in the right QR).
 * Right QR: '**' followed by the continuation.
 */

// The spec's own example header (date 102-05-23, total 0x154 = 340, seller 01234567).
const HEADER = 'AB112233441020523999900000144000001540000000001234567ydXZt4LAN1UHN/j1juVcRA==';

const latin = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const utf8 = (s: string) => new TextEncoder().encode(s);

/** Big5-encode via a reverse map of the platform's Big5 decoder. */
let big5Map: Map<string, number[]> | undefined;
function big5(s: string): Uint8Array {
  if (!big5Map) {
    big5Map = new Map();
    const dec = new TextDecoder('big5');
    for (let a = 0x81; a <= 0xfe; a++) {
      for (let b = 0x40; b <= 0xfe; b++) {
        if (b > 0x7e && b < 0xa1) continue;
        const ch = dec.decode(new Uint8Array([a, b]));
        if (ch.length === 1 && ch !== '�' && !big5Map.has(ch)) big5Map.set(ch, [a, b]);
      }
    }
  }
  const out: number[] = [];
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) out.push(code);
    else {
      const bytes = big5Map.get(ch);
      if (!bytes) throw new Error(`no Big5 code for ${ch}`);
      out.push(...bytes);
    }
  }
  return new Uint8Array(out);
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

const SPEC_ITEMS = [
  { name: '乾電池', quantity: 1, unitPrice: 105 },
  { name: '口罩', quantity: 1, unitPrice: 210 },
  { name: '牛奶', quantity: 1, unitPrice: 25 },
];

describe('parseEInvoice — the spec examples', () => {
  it('parses the header fields', () => {
    const inv = parseEInvoice([utf8(`${HEADER}:**********:3:3:1:乾電池:1:105:`), utf8('**口罩:1:210:牛奶:1:25')]);
    expect(inv).toMatchObject({
      invoiceNumber: 'AB11223344',
      date: '2013-05-23',
      randomCode: '9999',
      salesAmount: 0x144,
      totalAmount: 0x154,
      buyerId: '00000000',
      sellerId: '01234567',
    });
  });

  it('decodes Big5 items split across the left and right codes', () => {
    const left = concat(latin(`${HEADER}:**********:3:3:0:`), big5('乾電池:1:105:'));
    const right = concat(latin('**'), big5('口罩:1:210:牛奶:1:25'));
    expect(parseEInvoice([left, right]).items).toEqual(SPEC_ITEMS);
  });

  it('decodes UTF-8 items', () => {
    const inv = parseEInvoice([utf8(`${HEADER}:**********:3:3:1:乾電池:1:105:`), utf8('**口罩:1:210:牛奶:1:25')]);
    expect(inv.items).toEqual(SPEC_ITEMS);
  });

  it('decodes Base64 items (each code carries its own Base64 run)', () => {
    const inv = parseEInvoice([
      latin(`${HEADER}:**********:3:3:2:5Lm+6Zu75rGg`),
      latin('**OjE6MTA1OuWPo+e9qToxOjIxMDrniZvlpbY6MToyNQ=='),
    ]);
    expect(inv.items).toEqual(SPEC_ITEMS);
  });

  it('accepts the codes in any order, ignoring unrelated QR codes', () => {
    const left = utf8(`${HEADER}:**********:3:3:1:乾電池:1:105:`);
    const right = utf8('**口罩:1:210:牛奶:1:25');
    const other = utf8('https://example.com/promo');
    expect(parseEInvoice([other, right, left]).items).toEqual(SPEC_ITEMS);
  });
});

describe('parseEInvoice — real-world shapes', () => {
  const fuelHeader = (total: number) =>
    `QZ87654321` + '1141118' + 'A1b2' + '00000000' + total.toString(16).toUpperCase().padStart(8, '0') + '00000000' + '03244509' + 'abcdefghijklmnopqrstuv==';

  it('parses decimal litres and unit price with only the left code', () => {
    const inv = parseEInvoice([utf8(`${fuelHeader(952)}:**********:1:1:1:95無鉛汽油:30.12:31.6`)]);
    expect(inv).toMatchObject({ invoiceNumber: 'QZ87654321', date: '2025-11-18', salesAmount: 0, totalAmount: 952, sellerId: '03244509' });
    expect(inv.items).toEqual([{ name: '95無鉛汽油', quantity: 30.12, unitPrice: 31.6 }]);
  });

  it('only reads as many items as the QR codes say they record, ignoring trailing notes', () => {
    const inv = parseEInvoice([utf8(`${fuelHeader(952)}:**********:1:2:1:95無鉛汽油:30.12:31.6:會員卡號 1234`)]);
    expect(inv.items).toEqual([{ name: '95無鉛汽油', quantity: 30.12, unitPrice: 31.6 }]);
  });

  it('skips items whose quantity or price is not a number', () => {
    const inv = parseEInvoice([utf8(`${fuelHeader(900)}:**********:2:2:1:折扣:-:-30:95無鉛汽油:30:31`)]);
    expect(inv.items).toEqual([{ name: '95無鉛汽油', quantity: 30, unitPrice: 31 }]);
  });

  it('accepts a B2B invoice whose random code is four spaces', () => {
    const header = fuelHeader(952).replace('A1b2', '    ');
    expect(parseEInvoice([utf8(`${header}:**********:1:1:1:超級柴油:20:28.5`)]).randomCode).toBe('    ');
  });

  it('parses a header-only left code (no item details) with no items', () => {
    const inv = parseEInvoice([utf8(`${fuelHeader(500)}:**********:0:1:1:`)]);
    expect(inv.totalAmount).toBe(500);
    expect(inv.items).toEqual([]);
  });
});

describe('parseEInvoice — rejects', () => {
  it('throws EInvoiceError when there are no codes', () => {
    expect(() => parseEInvoice([])).toThrow(EInvoiceError);
  });

  it('throws EInvoiceError when no code is an e-invoice left code', () => {
    expect(() => parseEInvoice([utf8('https://example.com'), utf8('**口罩:1:210')])).toThrow(EInvoiceError);
  });

  it('throws EInvoiceError for an impossible date', () => {
    const bad = HEADER.replace('1020523', '1021399');
    expect(() => parseEInvoice([utf8(`${bad}:**********:0:0:1:`)])).toThrow(EInvoiceError);
  });
});

describe('fuelFromInvoice', () => {
  const invoice = (items: EInvoice['items'], totalAmount = 952): EInvoice => ({
    invoiceNumber: 'QZ87654321',
    date: '2025-11-18',
    randomCode: 'A1b2',
    salesAmount: 0,
    totalAmount,
    buyerId: '00000000',
    sellerId: '03244509',
    items,
  });

  it('fills date, litres, unit price, the paid total and the grade from a single fuel item', () => {
    expect(fuelFromInvoice(invoice([{ name: '95無鉛汽油', quantity: 30.12, unitPrice: 31.6 }]))).toEqual({
      invoiceNumber: 'QZ87654321',
      date: '2025-11-18',
      amount: 30.12,
      unitPrice: 31.6,
      total: 952,
      grade: '95',
    });
  });

  it.each([
    ['92無鉛汽油', '92'],
    ['98無鉛汽油', '98'],
    ['超級柴油', '柴油'],
    ['高級柴油', '柴油'],
    ['無鉛汽油', undefined],
  ])('maps %s to grade %s', (name, grade) => {
    expect(fuelFromInvoice(invoice([{ name, quantity: 20, unitPrice: 30 }]))?.grade).toBe(grade);
  });

  it('uses only the fuel line for the total when the invoice has other items', () => {
    const fill = fuelFromInvoice(
      invoice(
        [
          { name: '礦泉水', quantity: 1, unitPrice: 20 },
          { name: '95無鉛汽油', quantity: 30.12, unitPrice: 31.6 },
        ],
        972,
      ),
    );
    expect(fill).toMatchObject({ amount: 30.12, unitPrice: 31.6, total: 952 });
  });

  it('returns undefined when no item is fuel', () => {
    expect(fuelFromInvoice(invoice([{ name: '礦泉水', quantity: 1, unitPrice: 20 }]))).toBeUndefined();
    expect(fuelFromInvoice(invoice([]))).toBeUndefined();
  });
});

describe('receiptFromInvoice (maintenance / other expenses)', () => {
  const invoice = (items: EInvoice['items'], totalAmount: number): EInvoice => ({
    invoiceNumber: 'MK13572468',
    date: '2025-11-20',
    randomCode: 'Z9z9',
    salesAmount: 0,
    totalAmount,
    buyerId: '00000000',
    sellerId: '24681357',
    items,
  });

  it('fills the date and the invoice total, and lists the items for the note', () => {
    const fill = receiptFromInvoice(
      invoice(
        [
          { name: '機油 5W-30', quantity: 4, unitPrice: 320 },
          { name: '機油芯', quantity: 1, unitPrice: 250 },
          { name: '工資', quantity: 1, unitPrice: 300 },
        ],
        1830,
      ),
    );
    expect(fill).toEqual({
      invoiceNumber: 'MK13572468',
      date: '2025-11-20',
      total: 1830,
      note: '機油 5W-30 ×4 320元、機油芯 ×1 250元、工資 ×1 300元',
    });
  });

  it('keeps decimal quantities and prices as written', () => {
    expect(receiptFromInvoice(invoice([{ name: '停車費', quantity: 2.5, unitPrice: 40 }], 100)).note).toBe('停車費 ×2.5 40元');
  });

  it('leaves the note empty when the QR codes carry no items', () => {
    expect(receiptFromInvoice(invoice([], 500))).toEqual({ invoiceNumber: 'MK13572468', date: '2025-11-20', total: 500, note: '' });
  });
});
