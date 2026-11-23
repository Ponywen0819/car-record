import type { Deadline, MaintenanceRecord, ReminderRule, Vehicle } from '@car-record/shared';
import { addDays, addMonths, compareISO, daysBetween } from './dates';
import { alive } from './util';

/** 'unknown' = no baseline (never done, no purchase data) → UI asks to log the last service. */
export type ReminderLevel = 'overdue' | 'soon' | 'unknown' | 'ok';

export interface ReminderContext {
  maintenance: MaintenanceRecord[];
  currentOdometer: number | null;
  dailyKm: number | null;
  today: string;
  vehicle?: Vehicle;
}

export interface ReminderStatus {
  rule: ReminderRule;
  /** Last maintenance containing rule.itemKey; falls back to vehicle purchase data. */
  lastDate?: string;
  lastOdometer?: number;
  dueOdometer?: number;
  dueDate?: string;
  remainingKm?: number;
  remainingDays?: number;
  /** Earliest of dueDate and the date the km threshold is reached at dailyKm. */
  estimatedDueDate?: string;
  /** 'soon' = less than 10% of the interval (km or time) remaining. Whichever comes first wins. */
  level: ReminderLevel;
  /** Fraction of the interval used, max over km/time (0 = just done, 1 = due). */
  progress: number;
  /** Snoozed (snoozeUntilDate/Odometer not yet reached): level forced to 'ok'. */
  snoozed: boolean;
}

/** Share of the interval that must remain for a reminder to still be 'ok'. */
export const SOON_FRACTION = 0.1;

/** Latest (by date, then odometer) non-deleted maintenance of the rule's vehicle containing the item. */
function lastMaintenanceFor(rule: ReminderRule, maintenance: MaintenanceRecord[]): MaintenanceRecord | undefined {
  let best: MaintenanceRecord | undefined;
  for (const m of alive(maintenance)) {
    if (m.vehicleId !== rule.vehicleId) continue;
    if (!m.items.some((i) => i.itemKey === rule.itemKey)) continue;
    if (!best || compareISO(m.date, best.date) > 0 || (m.date === best.date && m.odometer > best.odometer)) best = m;
  }
  return best;
}

/** Whether the rule's snooze is still active. With both fields set, it ends when either is reached. */
function isSnoozed(rule: ReminderRule, currentOdometer: number | null, today: string): boolean {
  const conditions: boolean[] = [];
  if (rule.snoozeUntilDate !== undefined) conditions.push(today < rule.snoozeUntilDate);
  if (rule.snoozeUntilOdometer !== undefined) {
    // Without a current odometer we cannot confirm the snooze is still active.
    conditions.push(currentOdometer !== null && currentOdometer < rule.snoozeUntilOdometer);
  }
  return conditions.length > 0 && conditions.every(Boolean);
}

/**
 * Status of one maintenance reminder.
 * - Baseline: last maintenance containing rule.itemKey, else vehicle purchase date/odometer.
 * - km is only evaluated when currentOdometer is known; time only when a baseline date exists.
 * - 'overdue' = past due (remainingKm < 0 or remainingDays < 0); on the due day/km it is 'soon'.
 * - 'unknown' when neither dimension can be evaluated.
 * - progress is clamped at 0 below, not above (overdue reminders exceed 1).
 * - A snooze forces 'overdue'/'soon' to 'ok'; 'unknown' stays 'unknown'.
 */
export function computeReminderStatus(rule: ReminderRule, ctx: ReminderContext): ReminderStatus {
  const { today, currentOdometer, dailyKm } = ctx;
  const status: ReminderStatus = { rule, level: 'unknown', progress: 0, snoozed: false };

  const last = lastMaintenanceFor(rule, ctx.maintenance);
  const vehicle = ctx.vehicle && alive([ctx.vehicle])[0];
  if (last) {
    status.lastDate = last.date;
    status.lastOdometer = last.odometer;
  } else if (vehicle) {
    if (vehicle.purchaseDate !== undefined) status.lastDate = vehicle.purchaseDate;
    if (vehicle.purchaseOdometer !== undefined) status.lastOdometer = vehicle.purchaseOdometer;
  }

  const progresses: number[] = [];
  let overdue = false;
  let soon = false;
  const candidates: string[] = [];

  if (rule.everyKm !== undefined && status.lastOdometer !== undefined) {
    const everyKm = rule.everyKm;
    status.dueOdometer = status.lastOdometer + everyKm;
    if (currentOdometer !== null) {
      const remainingKm = status.dueOdometer - currentOdometer;
      status.remainingKm = remainingKm;
      progresses.push((currentOdometer - status.lastOdometer) / everyKm);
      if (remainingKm < 0) overdue = true;
      else if (remainingKm < everyKm * SOON_FRACTION) soon = true;
      if (dailyKm !== null && dailyKm > 0) candidates.push(addDays(today, Math.ceil(remainingKm / dailyKm)));
    }
  }

  if (rule.everyMonths !== undefined && status.lastDate !== undefined) {
    const dueDate = addMonths(status.lastDate, rule.everyMonths);
    const totalDays = daysBetween(status.lastDate, dueDate);
    const remainingDays = daysBetween(today, dueDate);
    status.dueDate = dueDate;
    status.remainingDays = remainingDays;
    candidates.push(dueDate);
    progresses.push(totalDays > 0 ? daysBetween(status.lastDate, today) / totalDays : 1);
    if (remainingDays < 0) overdue = true;
    else if (remainingDays < totalDays * SOON_FRACTION) soon = true;
  }

  if (candidates.length > 0) status.estimatedDueDate = candidates.reduce((a, b) => (b < a ? b : a));

  if (progresses.length > 0) {
    status.progress = Math.max(0, ...progresses);
    status.level = overdue ? 'overdue' : soon ? 'soon' : 'ok';
  }

  status.snoozed = isSnoozed(rule, currentOdometer, today);
  if (status.snoozed && (status.level === 'overdue' || status.level === 'soon')) status.level = 'ok';
  return status;
}

const LEVEL_ORDER: Record<ReminderLevel, number> = { overdue: 0, soon: 1, unknown: 2, ok: 3 };

/** Enabled, non-deleted rules; sorted overdue → soon → unknown → ok, then by progress desc. */
export function computeAllReminders(rules: ReminderRule[], ctx: ReminderContext): ReminderStatus[] {
  return alive(rules)
    .filter((r) => r.enabled)
    .map((r) => computeReminderStatus(r, ctx))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.progress - a.progress);
}

/**
 * Returns an updated copy of the rule with snooze fields set (does not touch updatedAt).
 * A new snooze replaces any previous one. km is ignored when currentOdometer is unknown.
 */
export function snoozeReminder(
  rule: ReminderRule,
  by: { km?: number; days?: number },
  ctx: { currentOdometer: number | null; today: string },
): ReminderRule {
  const { snoozeUntilDate: _d, snoozeUntilOdometer: _o, ...rest } = rule;
  const next: ReminderRule = { ...rest };
  if (by.km !== undefined && by.km > 0 && ctx.currentOdometer !== null) {
    next.snoozeUntilOdometer = ctx.currentOdometer + by.km;
  }
  if (by.days !== undefined && by.days > 0) next.snoozeUntilDate = addDays(ctx.today, by.days);
  return next;
}

/** Item keys of reminders that are 'overdue' or 'soon' (to preselect in the maintenance form). */
export function dueItemKeys(statuses: ReminderStatus[]): string[] {
  const keys: string[] = [];
  for (const s of statuses) {
    if ((s.level === 'overdue' || s.level === 'soon') && !keys.includes(s.rule.itemKey)) keys.push(s.rule.itemKey);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// deadlines
// ---------------------------------------------------------------------------

export interface DeadlineStatus {
  deadline: Deadline;
  /** dueDate - today (negative when overdue). */
  remainingDays: number;
  /** 'overdue' if past due, 'soon' if remainingDays <= remindDaysBefore, else 'ok'. */
  level: Exclude<ReminderLevel, 'unknown'>;
}

export function computeDeadlineStatus(deadline: Deadline, today: string): DeadlineStatus {
  const remainingDays = daysBetween(today, deadline.dueDate);
  const level = remainingDays < 0 ? 'overdue' : remainingDays <= deadline.remindDaysBefore ? 'soon' : 'ok';
  return { deadline, remainingDays, level };
}

/** Non-deleted, sorted by remainingDays asc. */
export function computeAllDeadlines(deadlines: Deadline[], today: string): DeadlineStatus[] {
  return alive(deadlines)
    .map((d) => computeDeadlineStatus(d, today))
    .sort((a, b) => a.remainingDays - b.remainingDays);
}

/**
 * Completing a repeating deadline rolls dueDate forward by repeatEveryMonths (from the old
 * dueDate, repeatedly until it is after today). Non-repeating → null (caller soft-deletes).
 * Each step is computed from the original dueDate (no month-end drift). Does not touch updatedAt.
 * A soft-deleted deadline also returns null.
 */
export function completeDeadline(deadline: Deadline, today: string): Deadline | null {
  if (deadline.deletedAt !== undefined || !deadline.repeatEveryMonths || deadline.repeatEveryMonths <= 0) return null;
  const step = deadline.repeatEveryMonths;
  let n = 1;
  let dueDate = addMonths(deadline.dueDate, step);
  while (dueDate <= today) {
    n++;
    dueDate = addMonths(deadline.dueDate, step * n);
  }
  return { ...deadline, dueDate };
}
