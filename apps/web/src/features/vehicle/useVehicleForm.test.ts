import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Vehicle } from '@car-record/shared';
import type { CarDB } from '../../db/db';
import * as repo from '../../db/repository';
import { useVehicleForm } from './useVehicleForm';

vi.mock('../../domain', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('../../test/fakeDomain')).domainFakes,
}));
vi.mock('../../db/repository', () => import('../../test/repoMock'));

const db = {} as CarDB;

beforeEach(() => vi.clearAllMocks());

describe('useVehicleForm', () => {
  it('starts empty with gasoline', () => {
    const { result } = renderHook(() => useVehicleForm({ db, now: () => 42 }));
    expect(result.current.values).toMatchObject({ name: '', fuelType: 'gasoline' });
    expect(result.current.isEdit).toBe(false);
  });

  it('requires a name and validates numbers', async () => {
    const { result } = renderHook(() => useVehicleForm({ db, now: () => 42 }));
    act(() => result.current.setField('year', '20x'));
    act(() => result.current.setField('purchaseOdometer', '-1'));
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res).toEqual({ ok: false, reason: 'invalid' });
    expect(result.current.errors).toMatchObject({ name: '請輸入名稱或車牌', year: '年份格式不正確', purchaseOdometer: '格式不正確' });
  });

  it('creates the vehicle and its default reminder rules', async () => {
    const { result } = renderHook(() => useVehicleForm({ db, now: () => 42 }));
    act(() => result.current.setField('name', ' 小白 '));
    act(() => result.current.setField('plate', 'ABC-1234'));
    act(() => result.current.setField('year', '2020'));
    act(() => result.current.setField('fuelType', 'hybrid'));
    act(() => result.current.setField('purchaseOdometer', '12'));
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res?.ok).toBe(true);
    const calls = vi.mocked(repo.saveRecord).mock.calls;
    expect(calls[0]![1]).toBe('vehicles');
    expect(calls[0]![2]).toEqual({ name: '小白', plate: 'ABC-1234', year: 2020, fuelType: 'hybrid', purchaseOdometer: 12 });
    const ruleCalls = calls.slice(1);
    expect(ruleCalls.map((c) => c[1])).toEqual(['reminderRules', 'reminderRules']);
    const vehicleId = res?.ok ? res.record.id : '';
    expect(ruleCalls[0]![2]).toMatchObject({ vehicleId, itemKey: 'engine_oil', enabled: true });
    expect(ruleCalls[0]![2]).not.toHaveProperty('updatedAt');
  });

  it('edits without touching reminder rules', async () => {
    const record: Vehicle = { id: 'v1', name: 'A', fuelType: 'diesel', createdAt: 3, updatedAt: 3, purchasePrice: 900000 };
    const { result } = renderHook(() => useVehicleForm({ db, record, now: () => 42 }));
    expect(result.current.values).toMatchObject({ name: 'A', fuelType: 'diesel', purchasePrice: '900000' });
    act(() => result.current.setField('name', 'B'));
    await act(async () => {
      await result.current.submit();
    });
    const calls = vi.mocked(repo.saveRecord).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]![2]).toMatchObject({ id: 'v1', createdAt: 3, name: 'B', purchasePrice: 900000 });
  });
});
