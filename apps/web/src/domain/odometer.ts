import type { ExpenseRecord, FuelRecord, MaintenanceRecord, Vehicle } from '@car-record/shared';
import { addDays, compareISO, daysBetween } from './dates';
import { alive } from './util';

export interface OdometerReading {
  date: string;
  odometer: number;
  source: 'fuel' | 'maintenance' | 'expense' | 'purchase';
  recordId?: string;
}

export function compareReadings(a: OdometerReading, b: OdometerReading): number {
  return compareISO(a.date, b.date) || a.odometer - b.odometer;
}

const sortReadings = (readings: OdometerReading[]) => [...readings].sort(compareReadings);

/** All odometer readings for one vehicle's records, sorted by date then odometer. */
export function collectReadings(input: {
  vehicle?: Vehicle;
  fuel: FuelRecord[];
  maintenance: MaintenanceRecord[];
  expenses?: ExpenseRecord[];
}): OdometerReading[] {
  const out: OdometerReading[] = [];
  const v = input.vehicle ? alive([input.vehicle])[0] : undefined;
  if (v &&v.purchaseDate !== undefined && v.purchaseOdometer !== undefined) {
    out.push({ date: v.purchaseDate, odometer: v.purchaseOdometer, source: 'purchase' });
  }
  for (const f of alive(input.fuel)) out.push({ date: f.date, odometer: f.odometer, source: 'fuel', recordId: f.id });
  for (const m of alive(input.maintenance)) {
    out.push({ date: m.date, odometer: m.odometer, source: 'maintenance', recordId: m.id });
  }
  for (const e of alive(input.expenses ?? [])) {
    if (e.odometer !== undefined) out.push({ date: e.date, odometer: e.odometer, source: 'expense', recordId: e.id });
  }
  return out.sort(compareReadings);
}

function rate(sorted: OdometerReading[]): number | null {
  if (sorted.length < 2) return null;
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const days = daysBetween(first.date, last.date);
  if (days < 1) return null;
  const km = last.odometer - first.odometer;
  return km < 0 ? null : km / days;
}

/**
 * Average km per day. Uses readings within the last `windowDays` (default 90) if that
 * window has >= 2 readings spanning >= 1 day; otherwise all readings. null if not computable.
 */
export function estimateDailyKm(readings: OdometerReading[], today: string, windowDays = 90): number | null {
  const sorted = sortReadings(readings);
  const cutoff = addDays(today, -windowDays);
  const windowed = sorted.filter((r) => r.date >= cutoff);
  return rate(windowed) ?? rate(sorted);
}

export interface OdometerEstimate {
  /** Rounded km. Equals last.odometer when dailyKm is null or last reading is today. */
  value: number;
  last: OdometerReading;
  dailyKm: number | null;
  isEstimated: boolean;
}

/** null when there are no readings. */
export function estimateOdometer(readings: OdometerReading[], today: string): OdometerEstimate | null {
  const sorted = sortReadings(readings);
  const last = sorted[sorted.length - 1];
  if (!last) return null;
  const dailyKm = estimateDailyKm(sorted, today);
  const days = daysBetween(last.date, today);
  if (dailyKm === null || days <= 0) return { value: last.odometer, last, dailyKm, isEstimated: false };
  return { value: Math.round(last.odometer + dailyKm * days), last, dailyKm, isEstimated: true };
}

export type OdometerCheck =
  | { ok: true }
  | { ok: false; reason: 'lower_than_previous'; previous: OdometerReading }
  | { ok: false; reason: 'higher_than_next'; next: OdometerReading };

/**
 * Validate a new/edited reading against the others (odometer must not decrease over time).
 * `excludeRecordId` skips the record being edited. Same-day readings never conflict.
 * Reports the most restrictive conflicting reading (highest earlier / lowest later).
 */
export function checkOdometer(
  value: number,
  date: string,
  readings: OdometerReading[],
  excludeRecordId?: string,
): OdometerCheck {
  const others =
    excludeRecordId === undefined ? readings : readings.filter((r) => r.recordId !== excludeRecordId);
  let previous: OdometerReading | undefined;
  let next: OdometerReading | undefined;
  for (const r of others) {
    if (r.date < date && r.odometer > value && (!previous || r.odometer > previous.odometer)) previous = r;
    if (r.date > date && r.odometer < value && (!next || r.odometer < next.odometer)) next = r;
  }
  if (previous) return { ok: false, reason: 'lower_than_previous', previous };
  if (next) return { ok: false, reason: 'higher_than_next', next };
  return { ok: true };
}
