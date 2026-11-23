import { describe, expect, it } from 'vitest';
import {
  checkOdometer,
  collectReadings,
  estimateDailyKm,
  estimateOdometer,
  type OdometerReading,
} from '../index';
import { expense, fuel, maint, vehicle } from './fixtures';

const r = (date: string, odometer: number, recordId?: string): OdometerReading => ({
  date,
  odometer,
  source: 'fuel',
  ...(recordId ? { recordId } : {}),
});

describe('collectReadings', () => {
  it('merges fuel, maintenance, expenses and purchase data, sorted by date then odometer', () => {
    const f1 = fuel({ id: 'f1', date: '2026-03-01', odometer: 12000 });
    const f2 = fuel({ id: 'f2', date: '2026-02-01', odometer: 11000 });
    const m1 = maint({ id: 'm1', date: '2026-03-01', odometer: 11900 });
    const e1 = expense({ id: 'e1', date: '2026-02-15', odometer: 11500, cost: 100 });
    const e2 = expense({ id: 'e2', date: '2026-02-16', cost: 100 }); // no odometer → skipped
    const readings = collectReadings({
      vehicle: vehicle({ purchaseDate: '2025-01-01', purchaseOdometer: 10 }),
      fuel: [f1, f2],
      maintenance: [m1],
      expenses: [e1, e2],
    });
    expect(readings).toEqual([
      { date: '2025-01-01', odometer: 10, source: 'purchase' },
      { date: '2026-02-01', odometer: 11000, source: 'fuel', recordId: 'f2' },
      { date: '2026-02-15', odometer: 11500, source: 'expense', recordId: 'e1' },
      { date: '2026-03-01', odometer: 11900, source: 'maintenance', recordId: 'm1' },
      { date: '2026-03-01', odometer: 12000, source: 'fuel', recordId: 'f1' },
    ]);
  });

  it('omits the purchase reading unless both purchaseDate and purchaseOdometer are set', () => {
    expect(collectReadings({ vehicle: vehicle({ purchaseDate: '2025-01-01' }), fuel: [], maintenance: [] })).toEqual([]);
    expect(collectReadings({ vehicle: vehicle({ purchaseOdometer: 5 }), fuel: [], maintenance: [] })).toEqual([]);
    expect(
      collectReadings({ vehicle: vehicle({ purchaseDate: '2025-01-01', purchaseOdometer: 0 }), fuel: [], maintenance: [] }),
    ).toEqual([{ date: '2025-01-01', odometer: 0, source: 'purchase' }]);
  });

  it('ignores soft-deleted records and a soft-deleted vehicle', () => {
    const readings = collectReadings({
      vehicle: vehicle({ purchaseDate: '2025-01-01', purchaseOdometer: 10, deletedAt: 5 }),
      fuel: [fuel({ date: '2026-01-01', odometer: 100, deletedAt: 9 })],
      maintenance: [maint({ date: '2026-01-02', odometer: 200, deletedAt: 9 })],
      expenses: [expense({ date: '2026-01-03', odometer: 300, cost: 1, deletedAt: 9 })],
    });
    expect(readings).toEqual([]);
  });

  it('works without vehicle and expenses', () => {
    expect(collectReadings({ fuel: [fuel({ id: 'x', date: '2026-01-01', odometer: 1 })], maintenance: [] })).toEqual([
      { date: '2026-01-01', odometer: 1, source: 'fuel', recordId: 'x' },
    ]);
  });
});

describe('estimateDailyKm', () => {
  const today = '2026-11-23';

  it('uses readings in the last 90 days when there are >= 2 spanning >= 1 day', () => {
    const readings = [
      r('2025-01-01', 0), // outside window: would change the rate if used
      r('2026-09-24', 10000),
      r('2026-10-24', 11500), // 30 days, 1500 km → 50/day
    ];
    expect(estimateDailyKm(readings, today)).toBeCloseTo(50);
  });

  it('includes a reading exactly windowDays ago', () => {
    const readings = [r('2026-08-25', 10000), r('2026-11-23', 19000)]; // exactly 90 days
    expect(estimateDailyKm(readings, today)).toBeCloseTo(100);
  });

  it('falls back to all readings when the window has fewer than 2 readings', () => {
    const readings = [r('2026-01-01', 0), r('2026-11-01', 30400)]; // 304 days
    expect(estimateDailyKm(readings, today)).toBeCloseTo(100);
  });

  it('falls back to all readings when the window readings are all on the same day', () => {
    const readings = [r('2026-06-01', 0), r('2026-11-20', 17200), r('2026-11-20', 17300)];
    // all: 2026-06-01 → 2026-11-20 = 172 days, 17300 km
    expect(estimateDailyKm(readings, today)).toBeCloseTo(17300 / 172);
  });

  it('respects a custom window', () => {
    const readings = [r('2026-01-01', 0), r('2026-11-13', 500), r('2026-11-23', 1500)];
    expect(estimateDailyKm(readings, today, 10)).toBeCloseTo(100);
    expect(estimateDailyKm(readings, today, 5)).toBeCloseTo(1500 / daysFrom('2026-01-01', '2026-11-23'));
  });

  it('does not require sorted input', () => {
    const readings = [r('2026-10-24', 11500), r('2026-09-24', 10000)];
    expect(estimateDailyKm(readings, today)).toBeCloseTo(50);
  });

  it('returns null when not computable', () => {
    expect(estimateDailyKm([], today)).toBeNull();
    expect(estimateDailyKm([r('2026-01-01', 5)], today)).toBeNull();
    expect(estimateDailyKm([r('2026-01-01', 5), r('2026-01-01', 50)], today)).toBeNull();
  });

  it('returns 0 for a car that was not driven', () => {
    expect(estimateDailyKm([r('2026-11-01', 500), r('2026-11-11', 500)], today)).toBe(0);
  });
});

function daysFrom(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

describe('estimateOdometer', () => {
  it('returns null with no readings', () => {
    expect(estimateOdometer([], '2026-11-23')).toBeNull();
  });

  it('extrapolates from the last reading at dailyKm', () => {
    const readings = [r('2026-10-01', 10000), r('2026-11-10', 12000)]; // 40 days, 50/day
    const est = estimateOdometer(readings, '2026-11-23');
    expect(est).not.toBeNull();
    expect(est!.dailyKm).toBeCloseTo(50);
    expect(est!.last).toEqual(readings[1]);
    expect(est!.value).toBe(12650);
    expect(est!.isEstimated).toBe(true);
  });

  it('rounds the estimate', () => {
    const readings = [r('2026-11-01', 0), r('2026-11-04', 100)]; // 33.33/day
    const est = estimateOdometer(readings, '2026-11-05')!;
    expect(est.value).toBe(133);
  });

  it('equals the last reading when it is today', () => {
    const readings = [r('2026-10-01', 10000), r('2026-11-23', 12000)];
    const est = estimateOdometer(readings, '2026-11-23')!;
    expect(est.value).toBe(12000);
    expect(est.isEstimated).toBe(false);
  });

  it('equals the last reading when it is in the future', () => {
    const readings = [r('2026-10-01', 10000), r('2026-12-01', 12000)];
    const est = estimateOdometer(readings, '2026-11-23')!;
    expect(est.value).toBe(12000);
    expect(est.isEstimated).toBe(false);
  });

  it('equals the last reading when dailyKm is null', () => {
    const est = estimateOdometer([r('2026-10-01', 10000)], '2026-11-23')!;
    expect(est).toEqual({ value: 10000, last: r('2026-10-01', 10000), dailyKm: null, isEstimated: false });
  });

  it('picks the last reading by date then odometer even when unsorted', () => {
    const readings = [r('2026-11-10', 12000), r('2026-10-01', 10000), r('2026-11-10', 11990)];
    expect(estimateOdometer(readings, '2026-11-10')!.last.odometer).toBe(12000);
  });
});

describe('checkOdometer', () => {
  const readings: OdometerReading[] = [
    { date: '2025-01-01', odometer: 10, source: 'purchase' },
    r('2026-01-01', 1000, 'a'),
    r('2026-02-01', 2000, 'b'),
    r('2026-03-01', 3000, 'c'),
  ];

  it('accepts a value consistent with the timeline', () => {
    expect(checkOdometer(2500, '2026-02-15', readings)).toEqual({ ok: true });
    expect(checkOdometer(5000, '2026-04-01', readings)).toEqual({ ok: true });
    expect(checkOdometer(5, '2024-01-01', readings)).toEqual({ ok: true });
    expect(checkOdometer(2000, '2026-02-15', readings)).toEqual({ ok: true }); // equal is fine
    expect(checkOdometer(1500, '2026-01-01', [])).toEqual({ ok: true });
  });

  it('rejects a value lower than an earlier-dated reading', () => {
    expect(checkOdometer(1500, '2026-02-15', readings)).toEqual({
      ok: false,
      reason: 'lower_than_previous',
      previous: readings[2],
    });
  });

  it('reports the highest earlier reading as previous', () => {
    expect(checkOdometer(500, '2026-02-15', readings)).toEqual({
      ok: false,
      reason: 'lower_than_previous',
      previous: readings[2],
    });
  });

  it('rejects a value higher than a later-dated reading', () => {
    expect(checkOdometer(3500, '2026-02-15', readings)).toEqual({
      ok: false,
      reason: 'higher_than_next',
      next: readings[3],
    });
    // reports the lowest later reading
    expect(checkOdometer(9999, '2025-12-01', readings)).toEqual({
      ok: false,
      reason: 'higher_than_next',
      next: readings[1],
    });
  });

  it('allows any order between same-day readings', () => {
    expect(checkOdometer(1900, '2026-02-01', readings)).toEqual({ ok: true });
    expect(checkOdometer(2100, '2026-02-01', readings)).toEqual({ ok: true });
    expect(checkOdometer(900, '2026-02-01', readings).ok).toBe(false);
  });

  it('skips the record being edited', () => {
    // Editing 'b' (2026-02-01) down to 1500: only conflicts with itself.
    expect(checkOdometer(1500, '2026-02-01', readings, 'b')).toEqual({ ok: true });
    // Moving 'c' earlier with its own value: would be higher than nothing else conflicting.
    expect(checkOdometer(3000, '2026-02-15', readings, 'c')).toEqual({ ok: true });
    // Without exclusion the same edit conflicts with itself.
    expect(checkOdometer(1500, '2026-02-15', readings).ok).toBe(false);
    // Exclusion does not hide other conflicts.
    expect(checkOdometer(500, '2026-02-01', readings, 'b')).toEqual({
      ok: false,
      reason: 'lower_than_previous',
      previous: readings[1],
    });
  });

  it('checks against the purchase reading', () => {
    expect(checkOdometer(5, '2025-06-01', readings)).toEqual({
      ok: false,
      reason: 'lower_than_previous',
      previous: readings[0],
    });
  });
});
