import type { ExpenseRecord, FuelRecord, MaintenanceRecord } from '@car-record/shared';
import { compareISO, daysBetween, monthOf, startOfNextMonth } from './dates';
import { fuelCost } from './fuel';
import { compareReadings, type OdometerReading } from './odometer';
import { alive } from './util';

/** category: 'fuel' | 'maintenance' | ExpenseCategory */
export interface CostEntry {
  date: string;
  category: string;
  cost: number;
}

/** Maintenance cost: the record total, else the sum of item costs, else undefined. */
export function maintenanceCost(m: MaintenanceRecord): number | undefined {
  if (m.cost !== undefined) return m.cost;
  let sum: number | undefined;
  for (const i of m.items) if (i.cost !== undefined) sum = (sum ?? 0) + i.cost;
  return sum;
}

/**
 * Every record with a cost > 0 (fuel uses cost, or amount*unitPrice when cost is missing;
 * maintenance uses cost, or the sum of item costs when cost is missing).
 * Ordered fuel, maintenance, expenses (input order within each).
 */
export function collectCosts(input: {
  fuel: FuelRecord[];
  maintenance: MaintenanceRecord[];
  expenses: ExpenseRecord[];
}): CostEntry[] {
  const out: CostEntry[] = [];
  const push = (date: string, category: string, cost: number | undefined) => {
    if (cost !== undefined && cost > 0) out.push({ date, category, cost });
  };
  for (const f of alive(input.fuel)) push(f.date, 'fuel', fuelCost(f));
  for (const m of alive(input.maintenance)) push(m.date, 'maintenance', maintenanceCost(m));
  for (const e of alive(input.expenses)) push(e.date, e.category, e.cost);
  return out;
}

export interface MonthlyCost {
  month: string;
  total: number;
  byCategory: Record<string, number>;
}

/** One entry per requested month (zero-filled), in the given order. */
export function monthlyCosts(entries: CostEntry[], months: string[]): MonthlyCost[] {
  const byMonth = new Map<string, MonthlyCost>();
  const result = months.map((month) => {
    const m: MonthlyCost = byMonth.get(month) ?? { month, total: 0, byCategory: {} };
    byMonth.set(month, m);
    return m;
  });
  for (const e of entries) {
    const m = byMonth.get(monthOf(e.date));
    if (!m) continue;
    m.total += e.cost;
    m.byCategory[e.category] = (m.byCategory[e.category] ?? 0) + e.cost;
  }
  // Duplicate requested months share one accumulator; return independent copies.
  return result.map((m) => ({ ...m, byCategory: { ...m.byCategory } }));
}

const inRange = (date: string, range?: { from: string; to: string }) =>
  !range || (date >= range.from && date <= range.to);

/** Totals per category within [from, to] inclusive (all if no range), sorted desc (ties by name). */
export function costByCategory(
  entries: CostEntry[],
  range?: { from: string; to: string },
): { category: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const e of entries) {
    if (inRange(e.date, range)) totals.set(e.category, (totals.get(e.category) ?? 0) + e.cost);
  }
  return [...totals]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total || compareISO(a.category, b.category));
}

/** Total cost / distance driven (max - min odometer) in the range. null if distance is 0. */
export function costPerKm(
  entries: CostEntry[],
  readings: OdometerReading[],
  range?: { from: string; to: string },
): number | null {
  const odos = readings.filter((r) => inRange(r.date, range)).map((r) => r.odometer);
  if (odos.length < 2) return null;
  const distance = Math.max(...odos) - Math.min(...odos);
  if (distance <= 0) return null;
  const total = entries.filter((e) => inRange(e.date, range)).reduce((s, e) => s + e.cost, 0);
  return total / distance;
}

/**
 * km driven per month, distributing each interval between consecutive readings across the
 * days it spans (linear interpolation). Zero-filled, in the given order.
 * An interval [a, b) covers the days from a (inclusive) to b (exclusive); same-day intervals
 * count in that day's month; decreasing intervals are ignored.
 */
export function monthlyDistance(readings: OdometerReading[], months: string[]): { month: string; km: number }[] {
  const totals = new Map<string, number>(months.map((m) => [m, 0]));
  const add = (month: string, km: number) => {
    const cur = totals.get(month);
    if (cur !== undefined) totals.set(month, cur + km);
  };
  const sorted = [...readings].sort(compareReadings);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const km = b.odometer - a.odometer;
    if (km <= 0) continue;
    const days = daysBetween(a.date, b.date);
    if (days <= 0) {
      add(monthOf(a.date), km);
      continue;
    }
    let cursor = a.date;
    while (cursor < b.date) {
      const boundary = startOfNextMonth(cursor);
      const segEnd = boundary < b.date ? boundary : b.date;
      add(monthOf(cursor), (km * daysBetween(cursor, segEnd)) / days);
      cursor = segEnd;
    }
  }
  return months.map((month) => ({ month, km: totals.get(month) ?? 0 }));
}
