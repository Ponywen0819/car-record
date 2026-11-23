import {
  DEFAULT_REMINDER_ITEM_KEYS,
  maintenanceItemsFor,
  uuidv7,
  type ReminderRule,
  type Vehicle,
} from '@car-record/shared';
import { compareISO } from './dates';
import { alive } from './util';

/** Reminder rules for a new vehicle from DEFAULT_REMINDER_ITEM_KEYS, filtered by fuel type. */
export function defaultReminderRules(vehicle: Vehicle, now: number): ReminderRule[] {
  const applicable = maintenanceItemsFor(vehicle.fuelType);
  const rules: ReminderRule[] = [];
  for (const key of DEFAULT_REMINDER_ITEM_KEYS) {
    const def = applicable.find((i) => i.key === key);
    if (!def || (def.defaultEveryKm === undefined && def.defaultEveryMonths === undefined)) continue;
    const r: ReminderRule = {
      id: uuidv7(now),
      createdAt: now,
      updatedAt: now,
      vehicleId: vehicle.id,
      itemKey: def.key,
      label: def.label,
      enabled: true,
    };
    if (def.defaultEveryKm !== undefined) r.everyKm = def.defaultEveryKm;
    if (def.defaultEveryMonths !== undefined) r.everyMonths = def.defaultEveryMonths;
    rules.push(r);
  }
  return rules;
}

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Most recent (by date, then updatedAt) non-empty value of `key`, or undefined. */
export function lastValue<T extends { date: string; updatedAt: number; deletedAt?: number }, K extends keyof T>(
  records: T[],
  key: K,
): T[K] | undefined {
  let best: T | undefined;
  for (const r of alive(records)) {
    if (isEmpty(r[key])) continue;
    if (!best || compareISO(r.date, best.date) > 0 || (r.date === best.date && r.updatedAt > best.updatedAt)) best = r;
  }
  return best?.[key];
}
