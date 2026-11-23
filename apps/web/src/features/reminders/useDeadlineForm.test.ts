import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Deadline, Vehicle } from '@car-record/shared';
import type { CarDB } from '../../db/db';
import * as repo from '../../db/repository';
import { useDeadlineForm } from './useDeadlineForm';

vi.mock('../../db/repository', () => import('../../test/repoMock'));

const db = {} as CarDB;
const vehicle: Vehicle = { id: 'v1', name: '小白', fuelType: 'gasoline', createdAt: 1, updatedAt: 1 };

beforeEach(() => vi.clearAllMocks());

describe('useDeadlineForm', () => {
  it('defaults to insurance, yearly, remind 30 days before', () => {
    const { result } = renderHook(() => useDeadlineForm({ db, vehicle }));
    expect(result.current.values).toEqual({
      kind: 'insurance',
      label: '保險',
      dueDate: '',
      remindDaysBefore: '30',
      repeatEveryMonths: '12',
      note: '',
    });
  });

  it('follows the kind label until edited', () => {
    const { result } = renderHook(() => useDeadlineForm({ db, vehicle }));
    act(() => result.current.selectKind('inspection'));
    expect(result.current.values.label).toBe('定期驗車');
    act(() => result.current.setField('label', '驗車（監理站）'));
    act(() => result.current.selectKind('license'));
    expect(result.current.values.label).toBe('驗車（監理站）');
  });

  it('requires a due date', async () => {
    const { result } = renderHook(() => useDeadlineForm({ db, vehicle }));
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res).toEqual({ ok: false, reason: 'invalid' });
    expect(result.current.errors.dueDate).toBe('請選擇到期日');
  });

  it('saves a deadline', async () => {
    const { result } = renderHook(() => useDeadlineForm({ db, vehicle }));
    act(() => result.current.setField('dueDate', '2027-03-01'));
    act(() => result.current.setField('repeatEveryMonths', ''));
    await act(async () => {
      await result.current.submit();
    });
    const [, table, draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(table).toBe('deadlines');
    expect(draft).toEqual({ vehicleId: 'v1', kind: 'insurance', label: '保險', dueDate: '2027-03-01', remindDaysBefore: 30 });
  });

  it('edits an existing deadline', async () => {
    const record: Deadline = {
      id: 'd1',
      vehicleId: 'v1',
      kind: 'tax',
      label: '牌照稅',
      dueDate: '2027-04-30',
      remindDaysBefore: 14,
      repeatEveryMonths: 12,
      createdAt: 2,
      updatedAt: 2,
    };
    const { result } = renderHook(() => useDeadlineForm({ db, vehicle, record }));
    expect(result.current.values).toMatchObject({ kind: 'tax', dueDate: '2027-04-30', remindDaysBefore: '14', repeatEveryMonths: '12' });
    await act(async () => {
      await result.current.submit();
    });
    const [, , draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(draft).toMatchObject({ id: 'd1', createdAt: 2, repeatEveryMonths: 12 });
  });
});
