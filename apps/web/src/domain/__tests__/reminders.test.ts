import { describe, expect, it } from 'vitest';
import {
  computeAllReminders,
  computeReminderStatus,
  dueItemKeys,
  snoozeReminder,
  type ReminderContext,
  type ReminderStatus,
} from '../index';
import { maint, rule, vehicle } from './fixtures';

const today = '2026-11-23';

const ctx = (over: Partial<ReminderContext> = {}): ReminderContext => ({
  maintenance: [],
  currentOdometer: null,
  dailyKm: null,
  today,
  ...over,
});

const lastOil = maint({ date: '2026-06-01', odometer: 10000, itemKeys: ['engine_oil', 'oil_filter'] });

describe('computeReminderStatus — km only', () => {
  const kmRule = rule({ everyKm: 5000, everyMonths: undefined });

  it('computes due odometer, remaining km and progress', () => {
    const s = computeReminderStatus(kmRule, ctx({ maintenance: [lastOil], currentOdometer: 13000 }));
    expect(s.rule).toBe(kmRule);
    expect(s.lastDate).toBe('2026-06-01');
    expect(s.lastOdometer).toBe(10000);
    expect(s.dueOdometer).toBe(15000);
    expect(s.remainingKm).toBe(2000);
    expect(s.dueDate).toBeUndefined();
    expect(s.remainingDays).toBeUndefined();
    expect(s.progress).toBeCloseTo(0.6);
    expect(s.level).toBe('ok');
    expect(s.snoozed).toBe(false);
    expect(s.estimatedDueDate).toBeUndefined(); // no dailyKm
  });

  it('estimates the due date from dailyKm', () => {
    const s = computeReminderStatus(kmRule, ctx({ maintenance: [lastOil], currentOdometer: 13000, dailyKm: 20 }));
    expect(s.estimatedDueDate).toBe('2027-03-03'); // 2000 km / 20 per day = 100 days
  });

  it('rounds the estimated days up', () => {
    const s = computeReminderStatus(kmRule, ctx({ maintenance: [lastOil], currentOdometer: 13000, dailyKm: 30 }));
    expect(s.estimatedDueDate).toBe('2027-01-29'); // 66.7 → 67 days
  });

  it('is soon with less than 10% of the km interval left', () => {
    expect(computeReminderStatus(kmRule, ctx({ maintenance: [lastOil], currentOdometer: 14600 })).level).toBe('soon');
    expect(computeReminderStatus(kmRule, ctx({ maintenance: [lastOil], currentOdometer: 14500 })).level).toBe('ok');
    expect(computeReminderStatus(kmRule, ctx({ maintenance: [lastOil], currentOdometer: 15000 })).level).toBe('soon');
  });

  it('is overdue once the due odometer is passed', () => {
    const s = computeReminderStatus(kmRule, ctx({ maintenance: [lastOil], currentOdometer: 15800 }));
    expect(s.level).toBe('overdue');
    expect(s.remainingKm).toBe(-800);
    expect(s.progress).toBeCloseTo(1.16);
  });

  it('is unknown when currentOdometer is null (km cannot be evaluated)', () => {
    const s = computeReminderStatus(kmRule, ctx({ maintenance: [lastOil] }));
    expect(s.level).toBe('unknown');
    expect(s.dueOdometer).toBe(15000);
    expect(s.remainingKm).toBeUndefined();
    expect(s.progress).toBe(0);
  });
});

describe('computeReminderStatus — months only', () => {
  const timeRule = rule({ itemKey: 'battery', label: '電瓶', everyKm: undefined, everyMonths: 6 });
  const battery = (date: string) => maint({ date, odometer: 10000, itemKeys: ['battery'] });

  it('computes due date, remaining days and progress', () => {
    const s = computeReminderStatus(timeRule, ctx({ maintenance: [battery('2026-09-01')], currentOdometer: 12000 }));
    expect(s.dueDate).toBe('2027-03-01');
    expect(s.remainingDays).toBe(98);
    expect(s.estimatedDueDate).toBe('2027-03-01');
    expect(s.dueOdometer).toBeUndefined();
    expect(s.remainingKm).toBeUndefined();
    expect(s.level).toBe('ok');
    expect(s.progress).toBeCloseTo(83 / 181);
  });

  it('is soon with less than 10% of the time interval left', () => {
    // 2026-06-01 → 2026-12-01 is 183 days; 8 days left < 18.3
    const s = computeReminderStatus(timeRule, ctx({ maintenance: [battery('2026-06-01')] }));
    expect(s.dueDate).toBe('2026-12-01');
    expect(s.remainingDays).toBe(8);
    expect(s.level).toBe('soon');
    expect(s.progress).toBeCloseTo(175 / 183);
  });

  it('is soon (not overdue) on the due date itself', () => {
    const s = computeReminderStatus(timeRule, ctx({ maintenance: [battery('2026-05-23')] }));
    expect(s.remainingDays).toBe(0);
    expect(s.level).toBe('soon');
  });

  it('is overdue after the due date', () => {
    const s = computeReminderStatus(timeRule, ctx({ maintenance: [battery('2026-05-01')] }));
    expect(s.dueDate).toBe('2026-11-01');
    expect(s.remainingDays).toBe(-22);
    expect(s.level).toBe('overdue');
    expect(s.progress).toBeGreaterThan(1);
  });

  it('works with currentOdometer null', () => {
    const s = computeReminderStatus(timeRule, ctx({ maintenance: [battery('2026-09-01')] }));
    expect(s.level).toBe('ok');
  });
});

describe('computeReminderStatus — km and months (whichever first)', () => {
  const both = rule({ everyKm: 5000, everyMonths: 6 }); // last 2026-06-01 @ 10000 → due 2026-12-01 / 15000

  it('is overdue if time is overdue even though km is fine', () => {
    const m = maint({ date: '2026-05-01', odometer: 10000 });
    const s = computeReminderStatus(both, ctx({ maintenance: [m], currentOdometer: 11000 }));
    expect(s.level).toBe('overdue');
  });

  it('is soon if km is nearly due even though time is fine', () => {
    const m = maint({ date: '2026-10-01', odometer: 10000 });
    const s = computeReminderStatus(both, ctx({ maintenance: [m], currentOdometer: 14800 }));
    expect(s.level).toBe('soon');
    expect(s.progress).toBeCloseTo(0.96);
  });

  it('progress is the max over km and time', () => {
    const m = maint({ date: '2026-09-01', odometer: 10000 }); // time: 83/181 ≈ 0.46
    const s = computeReminderStatus(both, ctx({ maintenance: [m], currentOdometer: 13500 })); // km: 0.7
    expect(s.progress).toBeCloseTo(0.7);
    expect(s.level).toBe('ok');
  });

  it('estimatedDueDate is the earlier of dueDate and the km date', () => {
    const m = maint({ date: '2026-09-01', odometer: 10000 }); // dueDate 2027-03-01
    const fast = computeReminderStatus(both, ctx({ maintenance: [m], currentOdometer: 13000, dailyKm: 100 }));
    expect(fast.estimatedDueDate).toBe('2026-12-13'); // 2000 km / 100 = 20 days
    const slow = computeReminderStatus(both, ctx({ maintenance: [m], currentOdometer: 13000, dailyKm: 5 }));
    expect(slow.estimatedDueDate).toBe('2027-03-01');
  });

  it('only evaluates time when currentOdometer is null', () => {
    const s = computeReminderStatus(both, ctx({ maintenance: [lastOil], dailyKm: 50 }));
    expect(s.remainingKm).toBeUndefined();
    expect(s.dueOdometer).toBe(15000);
    expect(s.dueDate).toBe('2026-12-01');
    expect(s.estimatedDueDate).toBe('2026-12-01');
    expect(s.level).toBe('soon');
  });
});

describe('computeReminderStatus — baseline', () => {
  const both = rule({ everyKm: 5000, everyMonths: 6 });

  it('uses the latest maintenance (by date, then odometer) containing the item', () => {
    const records = [
      maint({ date: '2026-03-01', odometer: 8000 }),
      maint({ date: '2026-09-01', odometer: 12000, itemKeys: ['tires'] }), // other item
      maint({ date: '2026-07-01', odometer: 11000, deletedAt: 3 }), // deleted
      maint({ date: '2026-06-01', odometer: 10000 }),
      maint({ date: '2026-06-01', odometer: 10050, itemKeys: ['wipers', 'engine_oil'] }),
      maint({ date: '2026-06-01', odometer: 9990 }),
    ];
    const s = computeReminderStatus(both, ctx({ maintenance: records, currentOdometer: 12000 }));
    expect(s.lastDate).toBe('2026-06-01');
    expect(s.lastOdometer).toBe(10050);
  });

  it('ignores maintenance of other vehicles', () => {
    const other = maint({ date: '2026-10-01', odometer: 12000, vehicleId: 'v2' });
    const s = computeReminderStatus(both, ctx({ maintenance: [lastOil, other], currentOdometer: 12000 }));
    expect(s.lastDate).toBe('2026-06-01');
  });

  it('falls back to vehicle purchase data', () => {
    const v = vehicle({ purchaseDate: '2026-09-01', purchaseOdometer: 10 });
    const s = computeReminderStatus(both, ctx({ vehicle: v, currentOdometer: 3010 }));
    expect(s.lastDate).toBe('2026-09-01');
    expect(s.lastOdometer).toBe(10);
    expect(s.dueOdometer).toBe(5010);
    expect(s.dueDate).toBe('2027-03-01');
    expect(s.level).toBe('ok');
  });

  it('uses partial purchase data for the dimension it covers', () => {
    const v = vehicle({ purchaseOdometer: 10 });
    const s = computeReminderStatus(both, ctx({ vehicle: v, currentOdometer: 4900 }));
    expect(s.lastDate).toBeUndefined();
    expect(s.lastOdometer).toBe(10);
    expect(s.dueDate).toBeUndefined();
    expect(s.level).toBe('soon');
  });

  it('is unknown without any baseline', () => {
    const s = computeReminderStatus(both, ctx({ currentOdometer: 50000, vehicle: vehicle() }));
    expect(s.level).toBe('unknown');
    expect(s.progress).toBe(0);
    expect(s.lastDate).toBeUndefined();
    expect(s.lastOdometer).toBeUndefined();
    expect(s.estimatedDueDate).toBeUndefined();
  });

  it('ignores a soft-deleted vehicle as baseline', () => {
    const v = vehicle({ purchaseDate: '2026-09-01', purchaseOdometer: 10, deletedAt: 5 });
    expect(computeReminderStatus(both, ctx({ vehicle: v, currentOdometer: 3010 })).level).toBe('unknown');
  });

  it('clamps progress at 0 when the baseline is in the future', () => {
    const m = maint({ date: '2026-12-01', odometer: 13000 });
    const s = computeReminderStatus(both, ctx({ maintenance: [m], currentOdometer: 12900 }));
    expect(s.progress).toBe(0);
    expect(s.level).toBe('ok');
  });
});

describe('computeReminderStatus — snooze', () => {
  const both = rule({ everyKm: 5000, everyMonths: 6 });
  const overdueCtx = ctx({ maintenance: [maint({ date: '2026-01-01', odometer: 10000 })], currentOdometer: 16000 });

  it('forces level ok while snoozeUntilDate is in the future', () => {
    const s = computeReminderStatus({ ...both, snoozeUntilDate: '2026-12-01' }, overdueCtx);
    expect(s.snoozed).toBe(true);
    expect(s.level).toBe('ok');
    expect(s.remainingKm).toBe(-1000); // numbers still reported
  });

  it('stops snoozing once the date is reached', () => {
    const s = computeReminderStatus({ ...both, snoozeUntilDate: today }, overdueCtx);
    expect(s.snoozed).toBe(false);
    expect(s.level).toBe('overdue');
  });

  it('snoozes by odometer until it is reached', () => {
    expect(computeReminderStatus({ ...both, snoozeUntilOdometer: 16500 }, overdueCtx)).toMatchObject({
      snoozed: true,
      level: 'ok',
    });
    expect(computeReminderStatus({ ...both, snoozeUntilOdometer: 16000 }, overdueCtx)).toMatchObject({
      snoozed: false,
      level: 'overdue',
    });
  });

  it('with both snooze fields, ends when either is reached', () => {
    expect(
      computeReminderStatus({ ...both, snoozeUntilOdometer: 16500, snoozeUntilDate: '2026-12-01' }, overdueCtx).snoozed,
    ).toBe(true);
    expect(
      computeReminderStatus({ ...both, snoozeUntilOdometer: 15000, snoozeUntilDate: '2026-12-01' }, overdueCtx).snoozed,
    ).toBe(false);
    expect(
      computeReminderStatus({ ...both, snoozeUntilOdometer: 16500, snoozeUntilDate: '2026-11-01' }, overdueCtx).snoozed,
    ).toBe(false);
  });

  it('cannot confirm an odometer snooze without a current odometer', () => {
    const timeOverdue = ctx({ maintenance: [maint({ date: '2026-01-01', odometer: 10000 })] });
    const s = computeReminderStatus({ ...both, snoozeUntilOdometer: 16500 }, timeOverdue);
    expect(s.snoozed).toBe(false);
    expect(s.level).toBe('overdue');
  });

  it('keeps unknown level when snoozed (there is nothing to snooze)', () => {
    const s = computeReminderStatus({ ...both, snoozeUntilDate: '2026-12-01' }, ctx());
    expect(s.snoozed).toBe(true);
    expect(s.level).toBe('unknown');
  });
});

describe('computeAllReminders', () => {
  it('excludes disabled and deleted rules and sorts overdue → soon → unknown → ok, then progress desc', () => {
    const records = [
      maint({ date: '2026-06-01', odometer: 10000, itemKeys: ['engine_oil', 'cabin_filter', 'air_filter'] }),
      maint({ date: '2026-01-01', odometer: 5000, itemKeys: ['battery', 'brake_fluid'] }),
    ];
    const rules = [
      rule({ id: 'ok-low', itemKey: 'air_filter', everyKm: 20000, everyMonths: 24 }), // ~0.24
      rule({ id: 'unknown', itemKey: 'tire_rotation', everyKm: 10000, everyMonths: undefined }),
      rule({ id: 'soon', itemKey: 'engine_oil', everyKm: 5000, everyMonths: 6 }), // time soon
      rule({ id: 'overdue-a', itemKey: 'battery', everyKm: undefined, everyMonths: 6 }), // 2026-07-01 due
      rule({ id: 'ok-high', itemKey: 'cabin_filter', everyKm: 10000, everyMonths: 12 }), // km 0.2, time ~0.48
      rule({ id: 'overdue-b', itemKey: 'brake_fluid', everyKm: 1000, everyMonths: undefined }), // km 7/1 → 7
      rule({ id: 'disabled', itemKey: 'engine_oil', enabled: false }),
      rule({ id: 'deleted', itemKey: 'engine_oil', deletedAt: 9 }),
    ];
    const statuses = computeAllReminders(rules, ctx({ maintenance: records, currentOdometer: 12000 }));
    expect(statuses.map((s) => s.rule.id)).toEqual(['overdue-b', 'overdue-a', 'soon', 'unknown', 'ok-high', 'ok-low']);
  });

  it('returns [] for no rules', () => {
    expect(computeAllReminders([], ctx())).toEqual([]);
  });
});

describe('snoozeReminder', () => {
  const base = rule({ updatedAt: 42 });

  it('snoozes by km from the current odometer', () => {
    const s = snoozeReminder(base, { km: 500 }, { currentOdometer: 13000, today });
    expect(s.snoozeUntilOdometer).toBe(13500);
    expect(s.snoozeUntilDate).toBeUndefined();
    expect(s.updatedAt).toBe(42);
    expect(base.snoozeUntilOdometer).toBeUndefined(); // not mutated
  });

  it('snoozes by days from today', () => {
    const s = snoozeReminder(base, { days: 14 }, { currentOdometer: null, today });
    expect(s.snoozeUntilDate).toBe('2026-12-07');
    expect(s.snoozeUntilOdometer).toBeUndefined();
  });

  it('sets both when both are given', () => {
    const s = snoozeReminder(base, { km: 1000, days: 30 }, { currentOdometer: 13000, today });
    expect(s).toMatchObject({ snoozeUntilOdometer: 14000, snoozeUntilDate: '2026-12-23' });
  });

  it('replaces a previous snooze', () => {
    const prev = { ...base, snoozeUntilOdometer: 9000, snoozeUntilDate: '2026-01-01' };
    const s = snoozeReminder(prev, { days: 7 }, { currentOdometer: 13000, today });
    expect(s.snoozeUntilDate).toBe('2026-11-30');
    expect('snoozeUntilOdometer' in s).toBe(false);
  });

  it('ignores km when the current odometer is unknown', () => {
    const s = snoozeReminder(base, { km: 500 }, { currentOdometer: null, today });
    expect(s.snoozeUntilOdometer).toBeUndefined();
  });

  it('a snoozed rule is reported as snoozed', () => {
    const s = snoozeReminder(base, { days: 7 }, { currentOdometer: 16000, today });
    const status = computeReminderStatus(s, ctx({ maintenance: [maint({ date: '2026-01-01', odometer: 10000 })], currentOdometer: 16000 }));
    expect(status).toMatchObject({ snoozed: true, level: 'ok' });
  });
});

describe('dueItemKeys', () => {
  const st = (itemKey: string, level: ReminderStatus['level']): ReminderStatus => ({
    rule: rule({ itemKey }),
    level,
    progress: 0,
    snoozed: false,
  });

  it('returns unique item keys of overdue and soon reminders', () => {
    expect(
      dueItemKeys([
        st('engine_oil', 'overdue'),
        st('battery', 'ok'),
        st('cabin_filter', 'soon'),
        st('tires', 'unknown'),
        st('engine_oil', 'soon'),
      ]),
    ).toEqual(['engine_oil', 'cabin_filter']);
    expect(dueItemKeys([])).toEqual([]);
  });
});
