/**
 * Small, contract-faithful stand-ins for src/domain functions, used by UI view-model tests
 * via `vi.mock('../../domain', ...)` so UI tests don't depend on the (parallel) domain work.
 */
import type { Deadline, ReminderRule, Vehicle } from '@car-record/shared';
import type {
  OdometerCheck,
  OdometerReading,
  PriceInput,
  ReminderStatus,
} from '../domain';

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pos = (n: number | undefined): n is number => n !== undefined && n > 0;

export function solvePrice(input: PriceInput): PriceInput {
  const { amount, unitPrice, total } = input;
  const given = [pos(amount), pos(unitPrice), pos(total)].filter(Boolean).length;
  if (given !== 2) return input;
  if (!pos(total)) return { ...input, total: Math.round(amount! * unitPrice!) };
  if (!pos(unitPrice)) return { ...input, unitPrice: r1(total / amount!) };
  return { ...input, amount: r2(total / unitPrice!) };
}

export function checkOdometer(
  value: number,
  date: string,
  readings: OdometerReading[],
  excludeRecordId?: string,
): OdometerCheck {
  const others = readings.filter((r) => r.recordId === undefined || r.recordId !== excludeRecordId);
  const previous = others.filter((r) => r.date <= date && r.odometer > value).at(-1);
  if (previous) return { ok: false, reason: 'lower_than_previous', previous };
  const next = others.find((r) => r.date > date && r.odometer < value);
  if (next) return { ok: false, reason: 'higher_than_next', next };
  return { ok: true };
}

export function lastValue<T extends { date: string; updatedAt: number; deletedAt?: number }, K extends keyof T>(
  records: T[],
  key: K,
): T[K] | undefined {
  const sorted = records
    .filter((r) => r.deletedAt === undefined && r[key] !== undefined && r[key] !== '')
    .sort((a, b) => (a.date === b.date ? b.updatedAt - a.updatedAt : a.date < b.date ? 1 : -1));
  return sorted[0]?.[key];
}

export function dueItemKeys(statuses: ReminderStatus[]): string[] {
  return statuses.filter((s) => s.level === 'overdue' || s.level === 'soon').map((s) => s.rule.itemKey);
}

export function defaultReminderRules(vehicle: Vehicle, now: number): ReminderRule[] {
  return [
    { id: `rule-oil-${vehicle.id}`, vehicleId: vehicle.id, itemKey: 'engine_oil', label: '機油', everyKm: 5000, everyMonths: 6, enabled: true, createdAt: now, updatedAt: now },
    { id: `rule-bat-${vehicle.id}`, vehicleId: vehicle.id, itemKey: 'battery', label: '電瓶檢查', everyMonths: 24, enabled: true, createdAt: now, updatedAt: now },
  ];
}

export function snoozeReminder(
  rule: ReminderRule,
  by: { km?: number; days?: number },
  ctx: { currentOdometer: number | null; today: string },
): ReminderRule {
  return {
    ...rule,
    ...(by.km !== undefined && ctx.currentOdometer !== null ? { snoozeUntilOdometer: ctx.currentOdometer + by.km } : {}),
    ...(by.days !== undefined ? { snoozeUntilDate: `${ctx.today}+${by.days}` } : {}),
  };
}

export function completeDeadline(deadline: Deadline, _today: string): Deadline | null {
  if (!deadline.repeatEveryMonths) return null;
  return { ...deadline, dueDate: '2027-11-23' };
}

export function todayISO(): string {
  return '2026-11-23';
}

export const domainFakes = {
  solvePrice,
  checkOdometer,
  lastValue,
  dueItemKeys,
  defaultReminderRules,
  snoozeReminder,
  completeDeadline,
  todayISO,
};
