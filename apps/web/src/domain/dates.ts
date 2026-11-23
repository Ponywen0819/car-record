/**
 * Local calendar-date helpers. Dates are 'YYYY-MM-DD' strings, months 'YYYY-MM'.
 *
 * Never parse 'YYYY-MM-DD' with `new Date(str)` (that is UTC midnight). Day arithmetic is
 * done on UTC epoch days built from the numeric parts, so it is timezone- and DST-independent.
 */

const MS_PER_DAY = 86_400_000;

const pad2 = (n: number) => String(n).padStart(2, '0');
const pad4 = (n: number) => String(n).padStart(4, '0');

/** Split 'YYYY-MM-DD' into numeric parts. */
export function parseISODate(date: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) throw new Error(`Invalid date: ${date}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

export function formatISODate(y: number, m: number, d: number): string {
  return `${pad4(y)}-${pad2(m)}-${pad2(d)}`;
}

/** Days since 1970-01-01 for a calendar date (no timezone involved). */
function epochDay(date: string): number {
  const { y, m, d } = parseISODate(date);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

function fromEpochDay(day: number): string {
  const dt = new Date(day * MS_PER_DAY);
  return formatISODate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Local calendar date of `now` as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  return formatISODate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Whole days from a to b (b - a). Both YYYY-MM-DD. DST-safe. */
export function daysBetween(a: string, b: string): number {
  return epochDay(b) - epochDay(a);
}

export function addDays(date: string, days: number): string {
  return fromEpochDay(epochDay(date) + Math.trunc(days));
}

/** Calendar month arithmetic, clamping to month end (2026-01-31 + 1 → 2026-02-28). */
export function addMonths(date: string, months: number): string {
  const { y, m, d } = parseISODate(date);
  const index = y * 12 + (m - 1) + Math.trunc(months);
  const ny = Math.floor(index / 12);
  const nm = index - ny * 12 + 1;
  return formatISODate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Local date of an epoch-ms timestamp. */
export function isoDateFromMs(ms: number): string {
  return todayISO(new Date(ms));
}

/** 'YYYY-MM' of a date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** First day ('YYYY-MM-01') of the month after `date`'s month. */
export function startOfNextMonth(date: string): string {
  const { y, m } = parseISODate(date);
  return m === 12 ? formatISODate(y + 1, 1, 1) : formatISODate(y, m + 1, 1);
}

/** The last n months ending with today's month, oldest first: ['2026-06', ..., '2026-11']. */
export function lastNMonths(today: string, n: number): string[] {
  const { y, m } = parseISODate(today);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const index = y * 12 + (m - 1) - i;
    const ny = Math.floor(index / 12);
    out.push(`${pad4(ny)}-${pad2(index - ny * 12 + 1)}`);
  }
  return out;
}

/** Lexicographic compare works for zero-padded ISO dates. */
export function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
