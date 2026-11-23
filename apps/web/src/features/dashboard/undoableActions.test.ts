import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deadline, ReminderRule } from '@car-record/shared';
import type { CarDB } from '../../db/db';
import * as repo from '../../db/repository';
import { completeDeadlineWithUndo, deleteWithUndo, snoozeAmount, snoozeWithUndo } from './undoableActions';

vi.mock('../../domain', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('../../test/fakeDomain')).domainFakes,
}));
vi.mock('../../db/repository', () => import('../../test/repoMock'));

const db = {} as CarDB;
const rule: ReminderRule = {
  id: 'r1',
  vehicleId: 'v1',
  itemKey: 'engine_oil',
  label: '機油',
  everyKm: 5000,
  everyMonths: 6,
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  rev: 9,
};

beforeEach(() => vi.clearAllMocks());

describe('snoozeAmount', () => {
  it('uses +500 km for km rules and +7 days for time rules', () => {
    expect(snoozeAmount(rule)).toEqual({ km: 500, days: 7 });
    expect(snoozeAmount({ ...rule, everyMonths: undefined })).toEqual({ km: 500 });
    expect(snoozeAmount({ ...rule, everyKm: undefined })).toEqual({ days: 7 });
  });
});

describe('snoozeWithUndo', () => {
  it('saves the snoozed rule and restores the previous one on undo', async () => {
    const res = await snoozeWithUndo(db, rule, { currentOdometer: 52000, today: '2026-11-23' });
    expect(res.message).toBe('已延後「機油」提醒');
    const [, table, draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(table).toBe('reminderRules');
    expect(draft).toMatchObject({ id: 'r1', snoozeUntilOdometer: 52500 });
    expect(draft).not.toHaveProperty('rev');
    expect(draft).not.toHaveProperty('updatedAt');

    await res.undo();
    const [, , restored] = vi.mocked(repo.saveRecord).mock.calls[1]!;
    expect(restored).toMatchObject({ id: 'r1' });
    expect(restored).toHaveProperty('snoozeUntilOdometer', undefined);
    expect(restored).toHaveProperty('snoozeUntilDate', undefined);
  });
});

const deadline: Deadline = {
  id: 'd1',
  vehicleId: 'v1',
  kind: 'insurance',
  label: '保險',
  dueDate: '2026-12-01',
  remindDaysBefore: 30,
  repeatEveryMonths: 12,
  createdAt: 1,
  updatedAt: 1,
};

describe('completeDeadlineWithUndo', () => {
  it('rolls a repeating deadline forward', async () => {
    const res = await completeDeadlineWithUndo(db, deadline, '2026-11-23');
    expect(res.message).toBe('「保險」已完成，下次到期 2027-11-23');
    expect(vi.mocked(repo.saveRecord).mock.calls[0]![2]).toMatchObject({ id: 'd1', dueDate: '2027-11-23' });
    await res.undo();
    expect(vi.mocked(repo.saveRecord).mock.calls[1]![2]).toMatchObject({ id: 'd1', dueDate: '2026-12-01' });
  });

  it('soft-deletes a one-off deadline', async () => {
    const res = await completeDeadlineWithUndo(db, { ...deadline, repeatEveryMonths: undefined }, '2026-11-23');
    expect(repo.softDelete).toHaveBeenCalledWith(db, 'deadlines', 'd1');
    expect(res.message).toBe('「保險」已完成');
    await res.undo();
    expect(repo.restoreRecord).toHaveBeenCalledWith(db, 'deadlines', 'd1');
  });
});

describe('deleteWithUndo', () => {
  it('soft-deletes and restores', async () => {
    const res = await deleteWithUndo(db, 'fuel', 'f1', '加油紀錄');
    expect(repo.softDelete).toHaveBeenCalledWith(db, 'fuel', 'f1');
    expect(res.message).toBe('已刪除加油紀錄');
    await res.undo();
    expect(repo.restoreRecord).toHaveBeenCalledWith(db, 'fuel', 'f1');
  });
});
