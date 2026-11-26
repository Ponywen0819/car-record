import { daysInMonth, formatISODate } from './dates';

/**
 * Taiwan e-invoice proof (電子發票證明聯) QR code parser, per MOF spec
 * 「電子發票證明聯一維及二維條碼規格說明」Ver 1.9.
 */

export class EInvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EInvoiceError';
    Object.setPrototypeOf(this, EInvoiceError.prototype);
  }
}

export interface EInvoiceItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface EInvoice {
  invoiceNumber: string;
  /** ISO date 'YYYY-MM-DD'. */
  date: string;
  randomCode: string;
  salesAmount: number;
  totalAmount: number;
  buyerId: string;
  sellerId: string;
  items: EInvoiceItem[];
}

export interface FuelInvoiceFill {
  invoiceNumber: string;
  date: string;
  amount: number;
  unitPrice: number;
  total: number;
  grade?: string;
}

export interface ReceiptInvoiceFill {
  invoiceNumber: string;
  date: string;
  total: number;
  note: string;
}

const HEADER_LEN = 77;
const COLON = 0x3a;
const STAR = 0x2a;

const HEADER_RE =
  /^([A-Z]{2}\d{8})(\d{3})(\d{2})(\d{2})([A-Za-z0-9 ]{4})([0-9A-Fa-f]{8})([0-9A-Fa-f]{8})(\d{8})(\d{8})[A-Za-z0-9+/=]{24}$/;

const DECIMAL_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Int8Array(128).fill(-1);
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

function latin1Slice(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (b.length === 0) return a;
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function decodeBase64(bytes: Uint8Array): Uint8Array {
  const vals: number[] = [];
  let padSeen = false;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue;
    if (b === 0x3d) {
      padSeen = true;
      continue;
    }
    if (padSeen || b >= 128 || B64_LOOKUP[b] === -1) {
      throw new EInvoiceError('Invalid Base64 payload in e-invoice QR code');
    }
    vals.push(B64_LOOKUP[b]!);
  }
  if (vals.length % 4 === 1) {
    throw new EInvoiceError('Invalid Base64 length in e-invoice QR code');
  }
  const out = new Uint8Array(Math.floor((vals.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < vals.length; i += 4) {
    const n = (vals[i]! << 18) | (vals[i + 1]! << 12) | ((vals[i + 2] ?? 0) << 6) | (vals[i + 3] ?? 0);
    out[o++] = (n >> 16) & 0xff;
    if (i + 2 < vals.length) out[o++] = (n >> 8) & 0xff;
    if (i + 3 < vals.length) out[o++] = n & 0xff;
  }
  return out;
}

function parseDecimal(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!DECIMAL_RE.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function parseItems(text: string, recordedCount: number): EInvoiceItem[] {
  if (recordedCount <= 0 || text.length === 0) return [];
  const parts = text.split(':');
  const items: EInvoiceItem[] = [];
  for (let i = 0; i < recordedCount; i++) {
    const base = i * 3;
    if (base + 2 >= parts.length) break;
    const name = parts[base]!;
    const quantity = parseDecimal(parts[base + 1]!);
    const unitPrice = parseDecimal(parts[base + 2]!);
    if (quantity === undefined || unitPrice === undefined) continue;
    items.push({ name, quantity, unitPrice });
  }
  return items;
}

/**
 * Parse one or two Taiwan e-invoice QR code byte payloads (order-independent;
 * unrelated QR codes in the scan batch are ignored).
 */
export function parseEInvoice(codes: readonly Uint8Array[]): EInvoice {
  let left: Uint8Array | undefined;
  let headerMatch: RegExpExecArray | null = null;
  let right: Uint8Array | undefined;

  for (const code of codes) {
    if (!right && code.length >= 2 && code[0] === STAR && code[1] === STAR) {
      right = code;
      continue;
    }
    if (!left && code.length >= HEADER_LEN && (code.length === HEADER_LEN || code[HEADER_LEN] === COLON)) {
      const m = HEADER_RE.exec(latin1Slice(code, 0, HEADER_LEN));
      if (m) {
        left = code;
        headerMatch = m;
      }
    }
  }

  if (!left || !headerMatch) {
    throw new EInvoiceError('No Taiwan e-invoice left QR code found');
  }

  const invoiceNumber = headerMatch[1]!;
  const year = Number(headerMatch[2]) + 1911;
  const month = Number(headerMatch[3]);
  const day = Number(headerMatch[4]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new EInvoiceError(`Invalid e-invoice ROC date: ${headerMatch[2]}${headerMatch[3]}${headerMatch[4]}`);
  }
  const date = formatISODate(year, month, day);
  const randomCode = headerMatch[5]!;
  const salesAmount = Number.parseInt(headerMatch[6]!, 16);
  const totalAmount = Number.parseInt(headerMatch[7]!, 16);
  const buyerId = headerMatch[8]!;
  const sellerId = headerMatch[9]!;

  let items: EInvoiceItem[] = [];
  if (left.length > HEADER_LEN) {
    const colon2 = left.length > 88 && left[88] === COLON ? 88 : left.indexOf(COLON, HEADER_LEN + 1);
    const colon3 = colon2 === -1 ? -1 : left.indexOf(COLON, colon2 + 1);
    const colon4 = colon3 === -1 ? -1 : left.indexOf(COLON, colon3 + 1);
    if (colon2 === -1 || colon3 === -1 || colon4 === -1) {
      throw new EInvoiceError('Malformed e-invoice QR metadata');
    }
    const colon5 = left.indexOf(COLON, colon4 + 1);
    const recordedStr = latin1Slice(left, colon2 + 1, colon3).trim();
    const encoding = latin1Slice(left, colon4 + 1, colon5 === -1 ? left.length : colon5).trim();
    if (!/^\d+$/.test(recordedStr)) {
      throw new EInvoiceError(`Invalid recorded item count: ${recordedStr}`);
    }
    const recordedCount = Number(recordedStr);
    const leftPayload = colon5 === -1 ? new Uint8Array(0) : left.subarray(colon5 + 1);
    const rightPayload = right ? right.subarray(2) : new Uint8Array(0);

    let decoded = '';
    if (encoding === '0') {
      decoded = new TextDecoder('big5').decode(concatBytes(leftPayload, rightPayload));
    } else if (encoding === '1') {
      decoded = new TextDecoder('utf-8').decode(concatBytes(leftPayload, rightPayload));
    } else if (encoding === '2') {
      const bytes = concatBytes(decodeBase64(leftPayload), decodeBase64(rightPayload));
      decoded = new TextDecoder('utf-8').decode(bytes);
    } else {
      throw new EInvoiceError(`Unsupported e-invoice encoding: ${encoding}`);
    }

    items = parseItems(decoded, recordedCount);
  }

  return {
    invoiceNumber,
    date,
    randomCode,
    salesAmount,
    totalAmount,
    buyerId,
    sellerId,
    items,
  };
}

const isFuelItem = (item: EInvoiceItem): boolean =>
  item.name.includes('汽油') || item.name.includes('柴油') || item.name.includes('無鉛');

function detectFuelGrade(name: string): string | undefined {
  if (name.includes('柴油')) return '柴油';
  if (name.includes('98')) return '98';
  if (name.includes('95')) return '95';
  if (name.includes('92')) return '92';
  return undefined;
}

/** Extract fuel form prefill values from a parsed e-invoice, or undefined if not a fuel receipt. */
export function fuelFromInvoice(inv: EInvoice): FuelInvoiceFill | undefined {
  const fuel = inv.items.find(isFuelItem);
  if (!fuel) return undefined;

  const total = inv.items.every(isFuelItem)
    ? inv.totalAmount
    : Math.round(fuel.quantity * fuel.unitPrice);

  const out: FuelInvoiceFill = {
    invoiceNumber: inv.invoiceNumber,
    date: inv.date,
    amount: fuel.quantity,
    unitPrice: fuel.unitPrice,
    total,
  };
  const grade = detectFuelGrade(fuel.name);
  if (grade !== undefined) out.grade = grade;
  return out;
}

/** Extract date, invoice total, and an item summary note for maintenance / expense forms. */
export function receiptFromInvoice(inv: EInvoice): ReceiptInvoiceFill {
  return {
    invoiceNumber: inv.invoiceNumber,
    date: inv.date,
    total: inv.totalAmount,
    note: inv.items.map((item) => `${item.name} ×${item.quantity} ${item.unitPrice}元`).join('、'),
  };
}
