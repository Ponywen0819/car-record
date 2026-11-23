/** Number parsing / formatting helpers for zh-TW forms. */

const FULL_WIDTH_DIGITS = /[０-９]/g;

export function isBlank(s: string | undefined | null): boolean {
  return s === undefined || s === null || s.trim() === '';
}

function normalize(input: string): string {
  return input
    .replace(FULL_WIDTH_DIGITS, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[，,\s]/g, '');
}

/**
 * Parse a user-typed non-negative decimal. undefined = blank, NaN = not a number.
 * Accepts thousand separators, spaces and full-width digits.
 */
export function parseDecimal(input: string): number | undefined {
  if (isBlank(input)) return undefined;
  const s = normalize(input);
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return Number.NaN;
  return Number(s);
}

/** Like parseDecimal but only whole numbers. */
export function parseInteger(input: string): number | undefined {
  const n = parseDecimal(input);
  if (n === undefined) return undefined;
  return Number.isInteger(n) ? n : Number.NaN;
}

export function formatNumber(n: number, digits = 0): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function formatKm(n: number): string {
  return `${formatNumber(Math.round(n))} km`;
}

export function formatMoney(n: number): string {
  return `$${formatNumber(Math.round(n))}`;
}

/** Value for prefilling an input: no grouping, '' for undefined. */
export function formatInputNumber(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '';
  return String(n);
}

/** '2026-11' → '2026 年 11 月' (or '11月' when short). */
export function monthLabel(month: string, short = false): string {
  const [y, m] = month.split('-');
  const mm = Number(m);
  return short ? `${mm}月` : `${y} 年 ${mm} 月`;
}

/** Drop undefined and '' values (keeps 0 / false). */
export function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === '') continue;
    out[k] = v;
  }
  return out as T;
}
