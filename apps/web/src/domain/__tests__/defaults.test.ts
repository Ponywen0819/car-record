import { describe, expect, it } from 'vitest';
import { MAINTENANCE_ITEMS, reminderRuleSchema, type FuelRecord } from '@car-record/shared';
import { defaultReminderRules, lastValue } from '../index';
import { fuel, maint, vehicle } from './fixtures';

const NOW = Date.UTC(2026, 10, 23, 3, 0, 0);

describe('defaultReminderRules', () => {
  it('creates the default rules for a gasoline car with catalog labels and intervals', () => {
    const v = vehicle({ id: 'car-1', fuelType: 'gasoline' });
    const rules = defaultReminderRules(v, NOW);
    expect(rules.map((r) => r.itemKey)).toEqual([
      'engine_oil',
      'oil_filter',
      'air_filter',
      'cabin_filter',
      'brake_fluid',
      'tire_rotation',
      'battery',
    ]);
    for (const r of rules) {
      const def = MAINTENANCE_ITEMS.find((i) => i.key === r.itemKey)!;
      expect(r.vehicleId).toBe('car-1');
      expect(r.label).toBe(def.label);
      expect(r.everyKm).toBe(def.defaultEveryKm);
      expect(r.everyMonths).toBe(def.defaultEveryMonths);
      expect(r.enabled).toBe(true);
      expect(r.createdAt).toBe(NOW);
      expect(r.updatedAt).toBe(NOW);
      expect(r.deletedAt).toBeUndefined();
      expect(r.snoozeUntilDate).toBeUndefined();
      expect(reminderRuleSchema.safeParse(r).success).toBe(true);
    }
    const oil = rules[0]!;
    expect(oil).toMatchObject({ label: '機油', everyKm: 5000, everyMonths: 6 });
    const rotation = rules.find((r) => r.itemKey === 'tire_rotation')!;
    expect('everyMonths' in rotation).toBe(false);
    const battery = rules.find((r) => r.itemKey === 'battery')!;
    expect('everyKm' in battery).toBe(false);
  });

  it('generates unique uuid v7 ids', () => {
    const rules = defaultReminderRules(vehicle(), NOW);
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('filters items by fuel type (EV has no oil / filters)', () => {
    expect(defaultReminderRules(vehicle({ fuelType: 'ev' }), NOW).map((r) => r.itemKey)).toEqual([
      'cabin_filter',
      'brake_fluid',
      'tire_rotation',
      'battery',
    ]);
    expect(defaultReminderRules(vehicle({ fuelType: 'diesel' }), NOW)).toHaveLength(7);
    expect(defaultReminderRules(vehicle({ fuelType: 'hybrid' }), NOW)).toHaveLength(7);
  });
});

describe('lastValue', () => {
  it('returns the most recent non-empty value by date, then updatedAt', () => {
    const records = [
      fuel({ date: '2026-01-01', odometer: 1, station: 'A', updatedAt: 1 }),
      fuel({ date: '2026-03-01', odometer: 3, station: 'C', updatedAt: 1 }),
      fuel({ date: '2026-03-01', odometer: 3, station: 'D', updatedAt: 5 }),
      fuel({ date: '2026-02-01', odometer: 2, station: 'B', updatedAt: 9 }),
    ];
    expect(lastValue(records, 'station')).toBe('D');
  });

  it('skips empty strings, whitespace, undefined and deleted records', () => {
    const records = [
      fuel({ date: '2026-01-01', odometer: 1, station: 'A' }),
      fuel({ date: '2026-02-01', odometer: 2, station: 'B', deletedAt: 3 }),
      fuel({ date: '2026-03-01', odometer: 3, station: '' }),
      fuel({ date: '2026-04-01', odometer: 4, station: '   ' }),
      fuel({ date: '2026-05-01', odometer: 5 }),
    ];
    expect(lastValue(records, 'station')).toBe('A');
  });

  it('returns undefined when there is no value', () => {
    expect(lastValue([] as FuelRecord[], 'station')).toBeUndefined();
    expect(lastValue([maint({ date: '2026-01-01', odometer: 1 })], 'shop')).toBeUndefined();
  });

  it('works for non-string values', () => {
    const records = [
      fuel({ date: '2026-01-01', odometer: 1, unitPrice: 29.5 }),
      fuel({ date: '2026-02-01', odometer: 2, unitPrice: 0 }),
    ];
    expect(lastValue(records, 'unitPrice')).toBe(0);
  });

  it('does not mutate the input order', () => {
    const records = [
      fuel({ id: 'b', date: '2026-02-01', odometer: 2, station: 'B' }),
      fuel({ id: 'a', date: '2026-01-01', odometer: 1, station: 'A' }),
    ];
    lastValue(records, 'station');
    expect(records.map((r) => r.id)).toEqual(['b', 'a']);
  });
});
