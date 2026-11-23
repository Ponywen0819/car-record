import { describe, expect, it } from 'vitest';
import {
  MAINTENANCE_ITEMS,
  DEFAULT_REMINDER_ITEM_KEYS,
  EXPENSE_CATEGORIES,
  DEADLINE_KINDS,
  maintenanceItemsFor,
  maintenanceItemLabel,
} from '../catalog';
import { expenseRecordSchema, deadlineSchema } from '../schemas';

describe('catalog', () => {
  it('has unique maintenance item keys with zh-TW labels', () => {
    const keys = MAINTENANCE_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const i of MAINTENANCE_ITEMS) expect(i.label.length).toBeGreaterThan(0);
  });

  it('default reminder items exist and each has an interval', () => {
    for (const key of DEFAULT_REMINDER_ITEM_KEYS) {
      const item = MAINTENANCE_ITEMS.find((i) => i.key === key);
      expect(item, key).toBeDefined();
      expect(item?.defaultEveryKm ?? item?.defaultEveryMonths).toBeDefined();
    }
  });

  it('engine oil defaults to 5000 km / 6 months', () => {
    const oil = MAINTENANCE_ITEMS.find((i) => i.key === 'engine_oil');
    expect(oil?.defaultEveryKm).toBe(5000);
    expect(oil?.defaultEveryMonths).toBe(6);
  });

  it('hides combustion-only items for EVs', () => {
    const ev = maintenanceItemsFor('ev').map((i) => i.key);
    expect(ev).not.toContain('engine_oil');
    expect(ev).toContain('cabin_filter');
    expect(maintenanceItemsFor('gasoline').map((i) => i.key)).toContain('engine_oil');
  });

  it('falls back to the key for unknown item labels', () => {
    expect(maintenanceItemLabel('engine_oil')).toBe('機油');
    expect(maintenanceItemLabel('custom_x')).toBe('custom_x');
  });

  it('expense categories and deadline kinds match the schemas', () => {
    for (const c of EXPENSE_CATEGORIES) {
      const r = { id: 'e', createdAt: 1, updatedAt: 1, vehicleId: 'v', date: '2026-01-01', category: c.key, cost: 1 };
      expect(expenseRecordSchema.safeParse(r).success, c.key).toBe(true);
    }
    for (const k of DEADLINE_KINDS) {
      const d = {
        id: 'd', createdAt: 1, updatedAt: 1, vehicleId: 'v',
        kind: k.key, label: k.label, dueDate: '2026-01-01', remindDaysBefore: 30,
      };
      expect(deadlineSchema.safeParse(d).success, k.key).toBe(true);
    }
  });
});
