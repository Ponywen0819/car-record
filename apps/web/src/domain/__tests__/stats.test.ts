import { describe, expect, it } from 'vitest';
import {
  collectCosts,
  costByCategory,
  costPerKm,
  monthlyCosts,
  monthlyDistance,
  type CostEntry,
  type OdometerReading,
} from '../index';
import { expense, fuel, maint } from './fixtures';

const r = (date: string, odometer: number): OdometerReading => ({ date, odometer, source: 'fuel' });

describe('collectCosts', () => {
  it('collects every cost > 0 from fuel, maintenance and expenses', () => {
    const entries = collectCosts({
      fuel: [
        fuel({ date: '2026-01-01', odometer: 1, cost: 1200 }),
        fuel({ date: '2026-01-02', odometer: 2, amount: 40, unitPrice: 30 }), // 1200 derived
        fuel({ date: '2026-01-03', odometer: 3 }), // no cost info
        fuel({ date: '2026-01-04', odometer: 4, cost: 0 }),
        fuel({ date: '2026-01-05', odometer: 5, cost: 999, deletedAt: 1 }),
        fuel({ date: '2026-01-06', odometer: 6, cost: 500, unitPrice: 1 }), // cost wins
      ],
      maintenance: [
        maint({ date: '2026-02-01', odometer: 10, cost: 3000 }),
        maint({ date: '2026-02-02', odometer: 11, items: [{ itemKey: 'engine_oil', cost: 800 }, { itemKey: 'oil_filter', cost: 200 }, { itemKey: 'wipers' }] }),
        maint({ date: '2026-02-03', odometer: 12, cost: 1500, items: [{ itemKey: 'engine_oil', cost: 800 }] }), // record cost wins
        maint({ date: '2026-02-04', odometer: 13 }), // no cost
        maint({ date: '2026-02-05', odometer: 14, cost: 9, deletedAt: 1 }),
      ],
      expenses: [
        expense({ date: '2026-03-01', cost: 4800, category: 'tax' }),
        expense({ date: '2026-03-02', cost: 0, category: 'parking' }),
        expense({ date: '2026-03-03', cost: 50, category: 'parking', deletedAt: 1 }),
      ],
    });
    expect(entries).toEqual([
      { date: '2026-01-01', category: 'fuel', cost: 1200 },
      { date: '2026-01-02', category: 'fuel', cost: 1200 },
      { date: '2026-01-06', category: 'fuel', cost: 500 },
      { date: '2026-02-01', category: 'maintenance', cost: 3000 },
      { date: '2026-02-02', category: 'maintenance', cost: 1000 },
      { date: '2026-02-03', category: 'maintenance', cost: 1500 },
      { date: '2026-03-01', category: 'tax', cost: 4800 },
    ]);
  });
});

const entries: CostEntry[] = [
  { date: '2026-01-05', category: 'fuel', cost: 1000 },
  { date: '2026-01-20', category: 'fuel', cost: 1100 },
  { date: '2026-01-31', category: 'maintenance', cost: 3000 },
  { date: '2026-03-01', category: 'tax', cost: 4800 },
  { date: '2026-03-15', category: 'fuel', cost: 900 },
  { date: '2026-04-01', category: 'parking', cost: 60 },
];

describe('monthlyCosts', () => {
  it('returns one zero-filled entry per requested month, in the given order', () => {
    expect(monthlyCosts(entries, ['2026-01', '2026-02', '2026-03'])).toEqual([
      { month: '2026-01', total: 5100, byCategory: { fuel: 2100, maintenance: 3000 } },
      { month: '2026-02', total: 0, byCategory: {} },
      { month: '2026-03', total: 5700, byCategory: { tax: 4800, fuel: 900 } },
    ]);
    expect(monthlyCosts(entries, ['2026-04', '2025-12']).map((m) => [m.month, m.total])).toEqual([
      ['2026-04', 60],
      ['2025-12', 0],
    ]);
    expect(monthlyCosts([], [])).toEqual([]);
  });
});

describe('costByCategory', () => {
  it('totals per category sorted desc', () => {
    expect(costByCategory(entries)).toEqual([
      { category: 'tax', total: 4800 },
      { category: 'fuel', total: 3000 }, // ties broken by category name
      { category: 'maintenance', total: 3000 },
      { category: 'parking', total: 60 },
    ]);
  });

  it('filters to an inclusive range', () => {
    expect(costByCategory(entries, { from: '2026-01-20', to: '2026-03-01' })).toEqual([
      { category: 'tax', total: 4800 },
      { category: 'maintenance', total: 3000 },
      { category: 'fuel', total: 1100 },
    ]);
    expect(costByCategory(entries, { from: '2027-01-01', to: '2027-12-31' })).toEqual([]);
  });
});

describe('costPerKm', () => {
  const readings = [r('2025-12-01', 9000), r('2026-01-01', 10000), r('2026-02-15', 11000), r('2026-03-31', 13000)];

  it('is total cost / (max - min odometer)', () => {
    const total = entries.reduce((s, e) => s + e.cost, 0);
    expect(costPerKm(entries, readings)).toBeCloseTo(total / 4000);
  });

  it('restricts entries and readings to the range', () => {
    // costs 2026-01-01..2026-03-31: 1000+1100+3000+4800+900 = 10800; km 13000-10000 = 3000
    expect(costPerKm(entries, readings, { from: '2026-01-01', to: '2026-03-31' })).toBeCloseTo(3.6);
  });

  it('returns null when distance is 0', () => {
    expect(costPerKm(entries, [])).toBeNull();
    expect(costPerKm(entries, [r('2026-01-01', 10000)])).toBeNull();
    expect(costPerKm(entries, readings, { from: '2026-02-01', to: '2026-02-28' })).toBeNull();
  });

  it('returns 0 when there are no costs but there is distance', () => {
    expect(costPerKm([], readings)).toBe(0);
  });
});

describe('monthlyDistance', () => {
  it('splits an interval across months by days', () => {
    // 2026-01-16 → 2026-03-16 is 59 days: Jan 16, Feb 28, Mar 15
    const res = monthlyDistance([r('2026-01-16', 10000), r('2026-03-16', 13000)], [
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ]);
    expect(res.map((m) => m.month)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03', '2026-04']);
    expect(res[0]!.km).toBe(0);
    expect(res[1]!.km).toBeCloseTo((3000 * 16) / 59);
    expect(res[2]!.km).toBeCloseTo((3000 * 28) / 59);
    expect(res[3]!.km).toBeCloseTo((3000 * 15) / 59);
    expect(res[4]!.km).toBe(0);
    expect(res.reduce((s, m) => s + m.km, 0)).toBeCloseTo(3000);
  });

  it('sums consecutive intervals and handles unsorted input', () => {
    const res = monthlyDistance(
      [r('2026-02-01', 1500), r('2026-01-01', 0), r('2026-01-11', 1000)],
      ['2026-01', '2026-02'],
    );
    expect(res[0]!.km).toBeCloseTo(1500);
    expect(res[1]!.km).toBe(0);
  });

  it('attributes same-day intervals to that month', () => {
    const res = monthlyDistance([r('2026-01-31', 100), r('2026-01-31', 300)], ['2026-01', '2026-02']);
    expect(res).toEqual([
      { month: '2026-01', km: 200 },
      { month: '2026-02', km: 0 },
    ]);
  });

  it('ignores decreasing intervals', () => {
    const res = monthlyDistance([r('2026-01-01', 1000), r('2026-01-11', 500)], ['2026-01']);
    expect(res).toEqual([{ month: '2026-01', km: 0 }]);
  });

  it('is zero-filled with no readings, in the given order', () => {
    expect(monthlyDistance([], ['2026-03', '2026-01'])).toEqual([
      { month: '2026-03', km: 0 },
      { month: '2026-01', km: 0 },
    ]);
  });

  it('spans a DST change without losing km', () => {
    const res = monthlyDistance([r('2026-02-25', 0), r('2026-03-15', 1800)], ['2026-02', '2026-03']);
    // 18 days: Feb 4 days (25,26,27,28), Mar 14 days
    expect(res[0]!.km).toBeCloseTo(400);
    expect(res[1]!.km).toBeCloseTo(1400);
  });
});
