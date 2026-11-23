import { describe, expect, it } from 'vitest';
import { completeDeadline, computeAllDeadlines, computeDeadlineStatus } from '../index';
import { deadline } from './fixtures';

const today = '2026-11-23';

describe('computeDeadlineStatus', () => {
  it('is ok when further away than remindDaysBefore', () => {
    const d = deadline({ dueDate: '2027-01-01', remindDaysBefore: 30 });
    expect(computeDeadlineStatus(d, today)).toEqual({ deadline: d, remainingDays: 39, level: 'ok' });
  });

  it('is soon within remindDaysBefore (inclusive) and on the due date', () => {
    expect(computeDeadlineStatus(deadline({ dueDate: '2026-12-23', remindDaysBefore: 30 }), today).level).toBe('soon');
    expect(computeDeadlineStatus(deadline({ dueDate: '2026-12-24', remindDaysBefore: 30 }), today).level).toBe('ok');
    expect(computeDeadlineStatus(deadline({ dueDate: today, remindDaysBefore: 0 }), today)).toMatchObject({
      remainingDays: 0,
      level: 'soon',
    });
  });

  it('is overdue once past due', () => {
    expect(computeDeadlineStatus(deadline({ dueDate: '2026-11-22' }), today)).toMatchObject({
      remainingDays: -1,
      level: 'overdue',
    });
  });
});

describe('computeAllDeadlines', () => {
  it('drops deleted deadlines and sorts by remainingDays asc', () => {
    const a = deadline({ id: 'a', dueDate: '2027-05-01' });
    const b = deadline({ id: 'b', dueDate: '2026-10-01' });
    const c = deadline({ id: 'c', dueDate: '2026-12-01' });
    const x = deadline({ id: 'x', dueDate: '2026-01-01', deletedAt: 3 });
    expect(computeAllDeadlines([a, b, c, x], today).map((s) => s.deadline.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('completeDeadline', () => {
  it('returns null for a non-repeating deadline', () => {
    expect(completeDeadline(deadline({ dueDate: '2026-12-01' }), today)).toBeNull();
  });

  it('rolls forward one period when completed early', () => {
    const d = deadline({ dueDate: '2026-12-10', repeatEveryMonths: 12, updatedAt: 7 });
    const next = completeDeadline(d, today)!;
    expect(next).toEqual({ ...d, dueDate: '2027-12-10' });
    expect(d.dueDate).toBe('2026-12-10'); // not mutated
  });

  it('rolls forward when completed on the due date', () => {
    expect(completeDeadline(deadline({ dueDate: today, repeatEveryMonths: 12 }), today)!.dueDate).toBe('2027-11-23');
  });

  it('rolls forward multiple periods until after today', () => {
    expect(completeDeadline(deadline({ dueDate: '2026-02-10', repeatEveryMonths: 3 }), today)!.dueDate).toBe(
      '2027-02-10',
    );
    expect(completeDeadline(deadline({ dueDate: '2024-11-23', repeatEveryMonths: 12 }), today)!.dueDate).toBe(
      '2027-11-23',
    );
  });

  it('clamps to month end without drifting', () => {
    // 01-31 → 02-28 → 03-31 → 04-30 (computed from the original date, not chained)
    expect(completeDeadline(deadline({ dueDate: '2026-01-31', repeatEveryMonths: 1 }), '2026-04-15')!.dueDate).toBe(
      '2026-04-30',
    );
    expect(completeDeadline(deadline({ dueDate: '2026-01-31', repeatEveryMonths: 1 }), '2026-02-01')!.dueDate).toBe(
      '2026-02-28',
    );
    expect(completeDeadline(deadline({ dueDate: '2026-01-31', repeatEveryMonths: 1 }), '2026-02-28')!.dueDate).toBe(
      '2026-03-31',
    );
  });

  it('returns null for a soft-deleted deadline', () => {
    expect(completeDeadline(deadline({ dueDate: '2026-12-01', repeatEveryMonths: 12, deletedAt: 1 }), today)).toBeNull();
  });
});
