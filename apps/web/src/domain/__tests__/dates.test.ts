import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysBetween, isoDateFromMs, lastNMonths, todayISO } from '../index';

describe('test environment', () => {
  it('runs in the timezone given by the TZ env var (when set)', () => {
    const tz = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.TZ;
    if (tz) expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(tz);
  });
});

describe('todayISO', () => {
  it('returns the local calendar date', () => {
    expect(todayISO(new Date(2026, 10, 23, 0, 0, 1))).toBe('2026-11-23');
    expect(todayISO(new Date(2026, 10, 23, 23, 59, 59))).toBe('2026-11-23');
    expect(todayISO(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });

  it('defaults to now', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('isoDateFromMs', () => {
  it('uses the local date of the timestamp', () => {
    expect(isoDateFromMs(new Date(2026, 0, 5, 0, 30).getTime())).toBe('2026-01-05');
    expect(isoDateFromMs(new Date(2026, 11, 31, 23, 59).getTime())).toBe('2026-12-31');
  });
});

describe('daysBetween', () => {
  it('counts whole days b - a', () => {
    expect(daysBetween('2026-01-01', '2026-01-02')).toBe(1);
    expect(daysBetween('2026-01-02', '2026-01-01')).toBe(-1);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('is DST-safe (US spring forward / fall back, EU)', () => {
    // America/New_York: 2026-03-08 spring forward, 2026-11-01 fall back.
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-03-08', '2026-03-09')).toBe(1);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1);
    expect(daysBetween('2026-01-01', '2026-07-01')).toBe(181);
    expect(daysBetween('2026-07-01', '2027-01-01')).toBe(184);
  });
});

describe('addDays', () => {
  it('adds and subtracts days across month/year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-11-23', 0)).toBe('2026-11-23');
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
  });

  it('is DST-safe', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-11-02', -2)).toBe('2026-10-31');
  });

  it('round-trips with daysBetween over a long range', () => {
    let d = '2025-12-25';
    for (let i = 1; i <= 800; i++) {
      const next = addDays(d, 1);
      expect(daysBetween(d, next)).toBe(1);
      d = next;
    }
    expect(daysBetween('2025-12-25', d)).toBe(800);
  });
});

describe('addMonths', () => {
  it('adds calendar months', () => {
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', 24)).toBe('2028-01-15');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
    expect(addMonths('2026-03-15', 0)).toBe('2026-03-15');
  });

  it('clamps to month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
  });
});

describe('lastNMonths', () => {
  it('returns n months ending with today’s month, oldest first', () => {
    expect(lastNMonths('2026-11-23', 6)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  });

  it('crosses year boundaries', () => {
    expect(lastNMonths('2026-02-01', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('handles n = 1 and n = 0', () => {
    expect(lastNMonths('2026-03-31', 1)).toEqual(['2026-03']);
    expect(lastNMonths('2026-03-31', 0)).toEqual([]);
  });
});
