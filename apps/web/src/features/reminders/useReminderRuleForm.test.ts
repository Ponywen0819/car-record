import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReminderRule, Vehicle } from '@car-record/shared';
import type { CarDB } from '../../db/db';
import * as repo from '../../db/repository';
import { useReminderRuleForm } from './useReminderRuleForm';

vi.mock('../../db/repository', () => import('../../test/repoMock'));

const db = {} as CarDB;
const vehicle: Vehicle = { id: 'v1', name: '小白', fuelType: 'gasoline', createdAt: 1, updatedAt: 1 };

beforeEach(() => vi.clearAllMocks());

describe('useReminderRuleForm', () => {
  it('suggests the first item without a rule and fills its defaults', () => {
    const { result } = renderHook(() => useReminderRuleForm({ db, vehicle, existingKeys: ['engine_oil'] }));
    expect(result.current.values).toMatchObject({
      itemKey: 'oil_filter',
      label: '機油芯',
      everyKm: '10000',
      everyMonths: '12',
      enabled: true,
    });
  });

  it('follows the item label until the label is edited by hand', () => {
    const { result } = renderHook(() => useReminderRuleForm({ db, vehicle, existingKeys: [] }));
    act(() => result.current.selectItem('battery'));
    expect(result.current.values).toMatchObject({ label: '電瓶', everyKm: '', everyMonths: '24' });
    act(() => result.current.setField('label', '電瓶檢查'));
    act(() => result.current.selectItem('wipers'));
    expect(result.current.values.label).toBe('電瓶檢查');
  });

  it('requires a km or month interval', async () => {
    const { result } = renderHook(() => useReminderRuleForm({ db, vehicle, existingKeys: [] }));
    act(() => result.current.setField('everyKm', ''));
    act(() => result.current.setField('everyMonths', ''));
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res).toEqual({ ok: false, reason: 'invalid' });
    expect(result.current.errors.everyKm).toBe('里程或月數至少填一個');
  });

  it('saves an edited rule and can clear the snooze', async () => {
    const record: ReminderRule = {
      id: 'r1',
      vehicleId: 'v1',
      itemKey: 'engine_oil',
      label: '機油',
      everyKm: 5000,
      everyMonths: 6,
      enabled: true,
      snoozeUntilOdometer: 53000,
      createdAt: 4,
      updatedAt: 4,
    };
    const { result } = renderHook(() => useReminderRuleForm({ db, vehicle, record, existingKeys: ['engine_oil'] }));
    expect(result.current.snoozed).toBe(true);
    act(() => result.current.setField('everyKm', '7,500'));
    act(() => result.current.setField('enabled', false));
    act(() => result.current.clearSnooze());
    await act(async () => {
      await result.current.submit();
    });
    const [, table, draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(table).toBe('reminderRules');
    expect(draft).toEqual({
      id: 'r1',
      createdAt: 4,
      vehicleId: 'v1',
      itemKey: 'engine_oil',
      label: '機油',
      everyKm: 7500,
      everyMonths: 6,
      enabled: false,
      snoozeUntilDate: undefined,
      snoozeUntilOdometer: undefined,
    });
  });
});
