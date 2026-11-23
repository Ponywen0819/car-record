/**
 * Writes that are confirmed with an "undo" toast instead of a dialog (SPEC §5.2).
 * Each returns the toast message and an undo function.
 */
import type { Deadline, ReminderRule, TableName } from '@car-record/shared';
import { completeDeadline, snoozeReminder } from '../../domain';
import type { CarDB } from '../../db/db';
import { restoreRecord, saveRecord, softDelete, type Draft } from '../../db/repository';
import { toDraft } from '../forms/formKit';

export interface Undoable {
  message: string;
  undo: () => Promise<void>;
}

/** +500 km for km-based rules, +7 days for time-based rules. */
export function snoozeAmount(rule: ReminderRule): { km?: number; days?: number } {
  const by: { km?: number; days?: number } = {};
  if (rule.everyKm !== undefined) by.km = 500;
  if (rule.everyMonths !== undefined || rule.everyKm === undefined) by.days = 7;
  return by;
}

function ruleDraft(rule: ReminderRule): Draft<'reminderRules'> {
  const d = toDraft(rule);
  // Explicit keys so the snooze is replaced even with merge-style updates.
  return { ...d, snoozeUntilDate: rule.snoozeUntilDate, snoozeUntilOdometer: rule.snoozeUntilOdometer } as Draft<'reminderRules'>;
}

export async function snoozeWithUndo(
  db: CarDB,
  rule: ReminderRule,
  ctx: { currentOdometer: number | null; today: string },
): Promise<Undoable> {
  const updated = snoozeReminder(rule, snoozeAmount(rule), ctx);
  await saveRecord(db, 'reminderRules', ruleDraft(updated));
  return {
    message: `已延後「${rule.label}」提醒`,
    undo: async () => {
      await saveRecord(db, 'reminderRules', ruleDraft(rule));
    },
  };
}

export async function completeDeadlineWithUndo(db: CarDB, deadline: Deadline, today: string): Promise<Undoable> {
  const next = completeDeadline(deadline, today);
  if (next) {
    await saveRecord(db, 'deadlines', toDraft(next) as Draft<'deadlines'>);
    return {
      message: `「${deadline.label}」已完成，下次到期 ${next.dueDate}`,
      undo: async () => {
        await saveRecord(db, 'deadlines', toDraft(deadline) as Draft<'deadlines'>);
      },
    };
  }
  await softDelete(db, 'deadlines', deadline.id);
  return {
    message: `「${deadline.label}」已完成`,
    undo: async () => {
      await restoreRecord(db, 'deadlines', deadline.id);
    },
  };
}

export async function deleteWithUndo(db: CarDB, table: TableName, id: string, what: string): Promise<Undoable> {
  await softDelete(db, table, id);
  return {
    message: `已刪除${what}`,
    undo: async () => {
      await restoreRecord(db, table, id);
    },
  };
}
