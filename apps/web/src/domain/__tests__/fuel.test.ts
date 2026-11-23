import { describe, expect, it } from 'vitest';
import {
  averageEconomy,
  computeFuelEconomy,
  detectEconomyAnomaly,
  solvePrice,
  type FuelEconomyPoint,
} from '../index';
import { fuel } from './fixtures';

describe('computeFuelEconomy', () => {
  it('returns [] for no records or a single full fill', () => {
    expect(computeFuelEconomy([])).toEqual([]);
    expect(computeFuelEconomy([fuel({ date: '2026-01-01', odometer: 1000 })])).toEqual([]);
  });

  it('computes full-to-full economy', () => {
    const points = computeFuelEconomy([
      fuel({ id: 'a', date: '2026-01-01', odometer: 1000, amount: 40, cost: 1200 }),
      fuel({ id: 'b', date: '2026-01-15', odometer: 1500, amount: 40, cost: 1300 }),
      fuel({ id: 'c', date: '2026-02-01', odometer: 2100, amount: 50, cost: 1500 }),
    ]);
    expect(points).toEqual([
      { recordId: 'b', date: '2026-01-15', odometer: 1500, distanceKm: 500, amount: 40, kmPerUnit: 12.5, cost: 1300 },
      { recordId: 'c', date: '2026-02-01', odometer: 2100, distanceKm: 600, amount: 50, kmPerUnit: 12, cost: 1500 },
    ]);
  });

  it('accumulates partial fills into the next full fill (full → partial → partial → full)', () => {
    const points = computeFuelEconomy([
      fuel({ id: 'a', date: '2026-01-01', odometer: 1000, amount: 40 }),
      fuel({ id: 'p1', date: '2026-01-05', odometer: 1200, amount: 10, isFull: false }),
      fuel({ id: 'p2', date: '2026-01-10', odometer: 1400, amount: 15, isFull: false }),
      fuel({ id: 'b', date: '2026-01-15', odometer: 1650, amount: 25 }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ recordId: 'b', distanceKm: 650, amount: 50, kmPerUnit: 13 });
  });

  it('ignores records before the first full fill', () => {
    const points = computeFuelEconomy([
      fuel({ id: 'p0', date: '2025-12-20', odometer: 500, amount: 20, isFull: false }),
      fuel({ id: 'a', date: '2026-01-01', odometer: 1000, amount: 40 }),
      fuel({ id: 'b', date: '2026-01-15', odometer: 1500, amount: 50 }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ recordId: 'b', distanceKm: 500, amount: 50, kmPerUnit: 10 });
  });

  it('sorts out-of-order input by odometer', () => {
    const points = computeFuelEconomy([
      fuel({ id: 'c', date: '2026-02-01', odometer: 2100, amount: 50 }),
      fuel({ id: 'a', date: '2026-01-01', odometer: 1000, amount: 40 }),
      fuel({ id: 'p', date: '2026-01-10', odometer: 1300, amount: 10, isFull: false }),
      fuel({ id: 'b', date: '2026-01-15', odometer: 1500, amount: 40 }),
    ]);
    expect(points.map((p) => [p.recordId, p.distanceKm, p.amount])).toEqual([
      ['b', 500, 50],
      ['c', 600, 50],
    ]);
  });

  it('skips intervals with zero or negative distance and restarts from that fill', () => {
    const points = computeFuelEconomy([
      fuel({ id: 'a', date: '2026-01-01', odometer: 1000, amount: 40 }),
      fuel({ id: 'a2', date: '2026-01-01', odometer: 1000, amount: 5 }), // top-up at same odometer
      fuel({ id: 'b', date: '2026-01-15', odometer: 1500, amount: 50 }),
    ]);
    expect(points.map((p) => [p.recordId, p.distanceKm, p.amount])).toEqual([['b', 500, 50]]);
  });

  it('ignores soft-deleted records', () => {
    const points = computeFuelEconomy([
      fuel({ id: 'a', date: '2026-01-01', odometer: 1000, amount: 40 }),
      fuel({ id: 'x', date: '2026-01-07', odometer: 1250, amount: 20, deletedAt: 5 }),
      fuel({ id: 'b', date: '2026-01-15', odometer: 1500, amount: 50 }),
    ]);
    expect(points.map((p) => [p.recordId, p.distanceKm, p.amount])).toEqual([['b', 500, 50]]);
  });

  it('includes cost only when every fill in the interval has one (cost ?? amount*unitPrice)', () => {
    const points = computeFuelEconomy([
      fuel({ id: 'a', date: '2026-01-01', odometer: 1000, amount: 40 }), // opening fill: not part of interval
      fuel({ id: 'p', date: '2026-01-05', odometer: 1200, amount: 10, isFull: false, unitPrice: 30 }),
      fuel({ id: 'b', date: '2026-01-15', odometer: 1500, amount: 40, cost: 1250 }),
      fuel({ id: 'p2', date: '2026-01-20', odometer: 1700, amount: 10, isFull: false }), // no cost
      fuel({ id: 'c', date: '2026-02-01', odometer: 2000, amount: 30, cost: 900 }),
    ]);
    expect(points[0]!.cost).toBe(300 + 1250);
    expect(points[1]!.cost).toBeUndefined();
    expect('cost' in points[1]!).toBe(false);
  });

  it('treats unitPrice 0 as a cost of 0 when cost is missing', () => {
    const points = computeFuelEconomy([
      fuel({ id: 'a', date: '2026-01-01', odometer: 1000, amount: 40 }),
      fuel({ id: 'b', date: '2026-01-15', odometer: 1500, amount: 40, unitPrice: 0 }),
    ]);
    expect(points[0]!.cost).toBe(0);
  });
});

const pt = (distanceKm: number, amount: number, i = 0): FuelEconomyPoint => ({
  recordId: `p${i}`,
  date: '2026-01-01',
  odometer: 1000 * (i + 1),
  distanceKm,
  amount,
  kmPerUnit: distanceKm / amount,
});

describe('averageEconomy', () => {
  it('is total distance / total amount', () => {
    expect(averageEconomy([pt(500, 40), pt(600, 60)])).toBeCloseTo(11);
  });

  it('uses only the last N points', () => {
    expect(averageEconomy([pt(100, 50), pt(500, 40), pt(600, 60)], 2)).toBeCloseTo(11);
    expect(averageEconomy([pt(500, 40)], 5)).toBeCloseTo(12.5);
  });

  it('returns null with no points', () => {
    expect(averageEconomy([])).toBeNull();
    expect(averageEconomy([pt(500, 40)], 0)).toBeNull();
  });
});

describe('detectEconomyAnomaly', () => {
  const prev = [pt(1200, 100, 0), pt(1200, 100, 1), pt(1200, 100, 2)]; // average 12

  it('flags a latest point more than 15% worse than the previous average', () => {
    const latest = pt(1000, 100, 3); // 10 → drop 16.7%
    const res = detectEconomyAnomaly([...prev, latest]);
    expect(res).not.toBeNull();
    expect(res!.latest).toBe(latest);
    expect(res!.average).toBeCloseTo(12);
    expect(res!.dropRatio).toBeCloseTo(2 / 12);
  });

  it('does not flag a drop within the threshold', () => {
    expect(detectEconomyAnomaly([...prev, pt(1050, 100, 3)])).toBeNull(); // 12.5% drop
    expect(detectEconomyAnomaly([...prev, pt(1500, 100, 3)])).toBeNull(); // better
  });

  it('respects a custom threshold', () => {
    expect(detectEconomyAnomaly([...prev, pt(1050, 100, 3)], 0.1)).not.toBeNull();
  });

  it('needs at least 3 previous points', () => {
    expect(detectEconomyAnomaly([pt(1200, 100), pt(1200, 100), pt(500, 100)])).toBeNull();
    expect(detectEconomyAnomaly([])).toBeNull();
  });
});

describe('solvePrice', () => {
  it('fills total from amount and unitPrice (rounded to integer)', () => {
    expect(solvePrice({ amount: 40.5, unitPrice: 31.2 })).toEqual({ amount: 40.5, unitPrice: 31.2, total: 1264 });
    expect(solvePrice({ amount: 10, unitPrice: 30.04 })).toEqual({ amount: 10, unitPrice: 30.04, total: 300 });
  });

  it('fills unitPrice from amount and total (1 decimal)', () => {
    expect(solvePrice({ amount: 40, total: 1250 })).toEqual({ amount: 40, total: 1250, unitPrice: 31.3 });
    expect(solvePrice({ amount: 3, total: 100 })).toEqual({ amount: 3, total: 100, unitPrice: 33.3 });
  });

  it('fills amount from unitPrice and total (2 decimals)', () => {
    expect(solvePrice({ unitPrice: 31.2, total: 1000 })).toEqual({ unitPrice: 31.2, total: 1000, amount: 32.05 });
    expect(solvePrice({ unitPrice: 3, total: 100 })).toEqual({ unitPrice: 3, total: 100, amount: 33.33 });
  });

  it('rounds half up without float artefacts', () => {
    expect(solvePrice({ amount: 1, total: 1.05 }).unitPrice).toBe(1.1);
    expect(solvePrice({ unitPrice: 1, total: 1.005 }).amount).toBe(1.01);
  });

  it('returns the input unchanged unless exactly two values are > 0', () => {
    expect(solvePrice({})).toEqual({});
    expect(solvePrice({ amount: 40 })).toEqual({ amount: 40 });
    expect(solvePrice({ amount: 40, unitPrice: 30, total: 999 })).toEqual({ amount: 40, unitPrice: 30, total: 999 });
    expect(solvePrice({ amount: 40, unitPrice: 0 })).toEqual({ amount: 40, unitPrice: 0 });
    expect(solvePrice({ amount: 40, unitPrice: -1 })).toEqual({ amount: 40, unitPrice: -1 });
    expect(solvePrice({ amount: NaN, unitPrice: 30 })).toEqual({ amount: NaN, unitPrice: 30 });
  });

  it('overwrites a non-positive third value', () => {
    expect(solvePrice({ amount: 40, unitPrice: 30, total: 0 })).toEqual({ amount: 40, unitPrice: 30, total: 1200 });
  });
});
