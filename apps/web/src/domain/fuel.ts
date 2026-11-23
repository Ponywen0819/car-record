import type { FuelRecord } from '@car-record/shared';
import { compareISO } from './dates';
import { alive, roundTo } from './util';

export interface FuelEconomyPoint {
  /** The full-tank record that closes this interval. */
  recordId: string;
  date: string;
  odometer: number;
  distanceKm: number;
  /** Fuel added since the previous full tank (including partial fills in between). */
  amount: number;
  /** km per litre (or km per kWh). */
  kmPerUnit: number;
  /** Sum of costs in the interval, if every fill in it had a cost. */
  cost?: number;
}

/** Cost of one fill: explicit cost, else amount * unitPrice, else undefined. */
export function fuelCost(f: FuelRecord): number | undefined {
  if (f.cost !== undefined) return f.cost;
  if (f.unitPrice !== undefined) return f.amount * f.unitPrice;
  return undefined;
}

/**
 * Full-to-full economy, oldest first. Partial fills accumulate into the next full fill.
 * Records are ordered by odometer (then date, createdAt); fills before the first full fill are
 * ignored; an interval with distance <= 0 is skipped and the closing fill becomes the new baseline.
 */
export function computeFuelEconomy(records: FuelRecord[]): FuelEconomyPoint[] {
  const sorted = alive(records).sort(
    (a, b) => a.odometer - b.odometer || compareISO(a.date, b.date) || a.createdAt - b.createdAt,
  );
  const points: FuelEconomyPoint[] = [];
  let base: FuelRecord | undefined;
  let amount = 0;
  let cost: number | undefined = 0;

  for (const f of sorted) {
    if (!base) {
      if (f.isFull) base = f;
      continue;
    }
    amount += f.amount;
    const c = fuelCost(f);
    cost = cost === undefined || c === undefined ? undefined : cost + c;
    if (!f.isFull) continue;

    const distanceKm = f.odometer - base.odometer;
    if (distanceKm > 0 && amount > 0) {
      const point: FuelEconomyPoint = {
        recordId: f.id,
        date: f.date,
        odometer: f.odometer,
        distanceKm,
        amount: roundTo(amount, 3),
        kmPerUnit: distanceKm / amount,
      };
      if (cost !== undefined) point.cost = roundTo(cost, 2);
      points.push(point);
    }
    base = f;
    amount = 0;
    cost = 0;
  }
  return points;
}

/** Total distance / total amount over the last `lastN` points (all if omitted). null if none. */
export function averageEconomy(points: FuelEconomyPoint[], lastN?: number): number | null {
  const slice = lastN === undefined ? points : lastN > 0 ? points.slice(-lastN) : [];
  let distance = 0;
  let amount = 0;
  for (const p of slice) {
    distance += p.distanceKm;
    amount += p.amount;
  }
  return amount > 0 ? distance / amount : null;
}

/**
 * Latest point worse than the average of the previous points by more than `threshold`
 * (default 0.15). Needs >= 3 previous points. null when no anomaly.
 */
export function detectEconomyAnomaly(
  points: FuelEconomyPoint[],
  threshold = 0.15,
): { latest: FuelEconomyPoint; average: number; dropRatio: number } | null {
  if (points.length < 4) return null;
  const latest = points[points.length - 1]!;
  const average = averageEconomy(points.slice(0, -1));
  if (average === null || average <= 0) return null;
  const dropRatio = (average - latest.kmPerUnit) / average;
  return dropRatio > threshold ? { latest, average, dropRatio } : null;
}

export interface PriceInput {
  amount?: number;
  unitPrice?: number;
  total?: number;
}

const given = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n) && n > 0;

/**
 * When exactly two of amount / unitPrice / total are given (> 0), fill the third.
 * Rounding: total → integer, unitPrice → 1 decimal, amount → 2 decimals.
 * Otherwise return the input unchanged.
 */
export function solvePrice(input: PriceInput): PriceInput {
  const { amount, unitPrice, total } = input;
  const a = given(amount);
  const u = given(unitPrice);
  const t = given(total);
  if (a && u && !t) return { ...input, total: roundTo(amount * unitPrice, 0) };
  if (a && t && !u) return { ...input, unitPrice: roundTo(total / amount, 1) };
  if (u && t && !a) return { ...input, amount: roundTo(total / unitPrice, 2) };
  return input;
}
