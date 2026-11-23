import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MaintenanceRecord, ReminderRule, Vehicle } from '@car-record/shared';
import type { CarDB } from '../../db/db';
import type { ReminderLevel, ReminderStatus } from '../../domain';
import * as repo from '../../db/repository';
import { useMaintenanceForm, type UseMaintenanceFormOptions } from './useMaintenanceForm';

vi.mock('../../domain', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('../../test/fakeDomain')).domainFakes,
}));
vi.mock('../../db/repository', () => import('../../test/repoMock'));

const db = {} as CarDB;
const vehicle: Vehicle = { id: 'v1', name: '小白', fuelType: 'gasoline', createdAt: 1, updatedAt: 1 };
const rule = (itemKey: string): ReminderRule => ({
  id: `r-${itemKey}`,
  vehicleId: 'v1',
  itemKey,
  label: itemKey,
  everyKm: 5000,
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
});
const status = (itemKey: string, level: ReminderLevel): ReminderStatus => ({
  rule: rule(itemKey),
  level,
  progress: 0.5,
  snoozed: false,
});
const m = (p: Partial<MaintenanceRecord>): MaintenanceRecord => ({
  id: 'm0',
  vehicleId: 'v1',
  date: '2026-10-01',
  odometer: 50000,
  kind: 'repair',
  items: [{ itemKey: 'tires' }],
  createdAt: 1,
  updatedAt: 1,
  ...p,
});

function setup(over: Partial<UseMaintenanceFormOptions> = {}) {
  const opts: UseMaintenanceFormOptions = {
    db,
    vehicle,
    readings: [{ date: '2026-10-01', odometer: 50000, source: 'maintenance', recordId: 'm0' }],
    estimate: 52340,
    today: '2026-11-23',
    maintenanceRecords: [m({ shop: '阿明保養廠' })],
    reminderStatuses: [status('engine_oil', 'overdue'), status('oil_filter', 'soon'), status('air_filter', 'ok')],
    ...over,
  };
  return renderHook((p: UseMaintenanceFormOptions) => useMaintenanceForm(p), { initialProps: opts });
}

beforeEach(() => vi.clearAllMocks());

describe('useMaintenanceForm defaults', () => {
  it('defaults to 定期保養, the last shop, and preselects due items', () => {
    const { result } = setup();
    expect(result.current.values).toMatchObject({
      date: '2026-11-23',
      odometer: '52340',
      kind: 'scheduled',
      shop: '阿明保養廠',
      items: ['engine_oil', 'oil_filter'],
    });
    expect(result.current.dueKeys).toEqual(['engine_oil', 'oil_filter']);
    expect(result.current.dirty).toBe(false);
  });

  it('uses an explicit preselection (reminder swipe) instead of due items', () => {
    const { result } = setup({ preselect: ['cabin_filter'] });
    expect(result.current.values.items).toEqual(['cabin_filter']);
  });

  it('offers only the items that apply to the fuel type', () => {
    const { result } = setup({ vehicle: { ...vehicle, fuelType: 'ev' }, reminderStatuses: [] });
    const keys = result.current.itemOptions.map((o) => o.value);
    expect(keys).not.toContain('engine_oil');
    expect(keys).toContain('tires');
  });
});

describe('editing items', () => {
  it('toggles items', () => {
    const { result } = setup({ reminderStatuses: [] });
    act(() => result.current.toggleItem('tires'));
    expect(result.current.values.items).toEqual(['tires']);
    act(() => result.current.toggleItem('tires'));
    expect(result.current.values.items).toEqual([]);
  });
});

describe('submit', () => {
  it('requires at least one item', async () => {
    const { result } = setup({ reminderStatuses: [] });
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res).toEqual({ ok: false, reason: 'invalid' });
    expect(result.current.errors.items).toBe('請至少選擇一個項目');
  });

  it('saves items with per-item costs and sums them when no total is given', async () => {
    const { result } = setup();
    act(() => result.current.setItemCost('engine_oil', '1,200'));
    act(() => result.current.setItemCost('oil_filter', '300'));
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res?.ok).toBe(true);
    const [, table, draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(table).toBe('maintenance');
    expect(draft).toEqual({
      vehicleId: 'v1',
      date: '2026-11-23',
      odometer: 52340,
      kind: 'scheduled',
      shop: '阿明保養廠',
      items: [
        { itemKey: 'engine_oil', cost: 1200 },
        { itemKey: 'oil_filter', cost: 300 },
      ],
      cost: 1500,
    });
  });

  it('prefers the typed total over the item sum', async () => {
    const { result } = setup();
    act(() => result.current.setItemCost('engine_oil', '1200'));
    act(() => result.current.setField('cost', '2000'));
    await act(async () => {
      await result.current.submit();
    });
    const [, , draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(draft).toMatchObject({ cost: 2000 });
  });

  it('warns on a lower odometer before saving', async () => {
    const { result } = setup();
    act(() => result.current.setField('odometer', '49000'));
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res).toEqual({ ok: false, reason: 'warning' });
    expect(result.current.warning).not.toBeNull();
  });

  it('loads an existing record for editing', async () => {
    const record = m({ id: 'm9', createdAt: 9, items: [{ itemKey: 'tires', cost: 8000 }], cost: 8000, shop: 'X', note: 'n' });
    const { result } = setup({ record });
    expect(result.current.isEdit).toBe(true);
    expect(result.current.values).toMatchObject({
      date: '2026-10-01',
      odometer: '50000',
      kind: 'repair',
      items: ['tires'],
      itemCosts: { tires: '8000' },
      cost: '8000',
      shop: 'X',
      note: 'n',
    });
    await act(async () => {
      await result.current.submit();
    });
    const [, , draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(draft).toMatchObject({ id: 'm9', createdAt: 9 });
  });
});
