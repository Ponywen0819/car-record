/**
 * UI view-models wired to the REAL domain, repository and Dexie (fake-indexeddb): checks that
 * the drafts the forms build pass the shared zod schemas and land in the cache + outbox.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Vehicle } from '@car-record/shared';
import { createDb, type CarDB } from '../db/db';
import { buildSnapshot, parseSnapshot } from '../domain';
import { importRecords } from '../db/repository';
import { loadVehicleData } from '../hooks/useVehicleData';
import { deriveVehicleState } from './dashboard/dashboardModel';
import { completeDeadlineWithUndo, deleteWithUndo, snoozeWithUndo } from './dashboard/undoableActions';
import { useVehicleForm } from './vehicle/useVehicleForm';
import { useFuelForm } from './fuel/useFuelForm';
import { useMaintenanceForm } from './maintenance/useMaintenanceForm';
import { useExpenseForm } from './expense/useExpenseForm';
import { useReminderRuleForm } from './reminders/useReminderRuleForm';
import { useDeadlineForm } from './reminders/useDeadlineForm';
import { readAllTables } from './settings/exportModel';
import { buildStats } from './stats/statsModel';
import { toRecordRows } from './records/recordsModel';

let db: CarDB;
let n = 0;
const TODAY = '2026-11-23';

beforeEach(() => {
  db = createDb(`test-integration-${Date.now()}-${n++}`);
});
afterEach(() => db.close());

async function createVehicle(): Promise<Vehicle> {
  const { result } = renderHook(() => useVehicleForm({ db }));
  act(() => result.current.setField('name', '小白'));
  act(() => result.current.setField('purchaseOdometer', '1000'));
  act(() => result.current.setField('purchaseDate', '2026-01-01'));
  let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
  await act(async () => {
    res = await result.current.submit();
  });
  if (!res?.ok) throw new Error(`vehicle not saved: ${JSON.stringify(res)}`);
  return res.record;
}

async function state(vehicleId: string) {
  const data = (await loadVehicleData(db, vehicleId))!;
  return { data, state: deriveVehicleState(data, TODAY) };
}

describe('integration with real domain + repository', () => {
  it('onboarding creates the vehicle and its default reminder rules', async () => {
    const v = await createVehicle();
    const rules = await db.reminderRules.where('vehicleId').equals(v.id).toArray();
    expect(rules.length).toBeGreaterThanOrEqual(5);
    expect(rules.every((r) => r.enabled)).toBe(true);
    expect(await db.outbox.count()).toBe(1 + rules.length);
  });

  it('fuel → maintenance → expense forms save valid records that drive the dashboard', async () => {
    const v = await createVehicle();
    let s = await state(v.id);

    for (const [date, odo, amount, total] of [
      ['2026-10-01', '3000', '40', '1200'],
      ['2026-10-20', '3500', '35', '1050'],
      ['2026-11-10', '4000', '36', '1100'],
    ] as const) {
      const fuel = renderHook(() =>
        useFuelForm({ db, vehicle: v, readings: s.state.readings, estimate: s.state.estimate?.value ?? null, today: TODAY, fuelRecords: s.data.fuel }),
      );
      act(() => fuel.result.current.setField('date', date));
      act(() => fuel.result.current.setField('odometer', odo));
      act(() => fuel.result.current.setField('amount', amount));
      act(() => fuel.result.current.setField('total', total));
      act(() => fuel.result.current.setField('station', '中油'));
      let res: Awaited<ReturnType<typeof fuel.result.current.submit>> | undefined;
      await act(async () => {
        res = await fuel.result.current.submit();
      });
      expect(res?.ok).toBe(true);
      s = await state(v.id);
    }
    expect(s.data.fuel).toHaveLength(3);
    expect(s.data.fuel.find((f) => f.date === '2026-10-01')).toMatchObject({ unitPrice: 30, cost: 1200 });
    expect(s.state.estimate?.value).toBeGreaterThanOrEqual(4000);
    expect(s.state.latestEconomy).not.toBeNull();

    const maint = renderHook(() =>
      useMaintenanceForm({
        db,
        vehicle: v,
        readings: s.state.readings,
        estimate: s.state.estimate?.value ?? null,
        today: TODAY,
        maintenanceRecords: s.data.maintenance,
        reminderStatuses: s.state.reminders,
        preselect: ['engine_oil'],
      }),
    );
    act(() => maint.result.current.setItemCost('engine_oil', '1500'));
    let mres: Awaited<ReturnType<typeof maint.result.current.submit>> | undefined;
    await act(async () => {
      mres = await maint.result.current.submit();
    });
    expect(mres?.ok).toBe(true);

    const exp = renderHook(() =>
      useExpenseForm({ db, vehicle: v, readings: s.state.readings, estimate: null, today: TODAY, expenseRecords: [] }),
    );
    act(() => exp.result.current.setField('category', 'insurance'));
    act(() => exp.result.current.setField('cost', '12000'));
    act(() => exp.result.current.setField('recurring', true));
    let eres: Awaited<ReturnType<typeof exp.result.current.submit>> | undefined;
    await act(async () => {
      eres = await exp.result.current.submit();
    });
    expect(eres?.ok).toBe(true);

    s = await state(v.id);
    const oil = s.state.reminders.find((r) => r.rule.itemKey === 'engine_oil');
    expect(oil?.lastDate).toBe(TODAY);
    expect(toRecordRows(s.data, 'all', v.fuelType)).toHaveLength(5);
    const stats = buildStats(s.data, TODAY, 6);
    expect(stats.totalCost).toBe(1200 + 1050 + 1100 + 1500 + 12000);
    expect(stats.months).toHaveLength(6);
  });

  it('odometer going backwards needs a second tap with the real checkOdometer', async () => {
    const v = await createVehicle();
    const readings = [{ date: '2026-11-01', odometer: 5000, source: 'fuel' as const, recordId: 'x' }];
    const fuel = renderHook(() => useFuelForm({ db, vehicle: v, readings, estimate: 5100, today: TODAY, fuelRecords: [] }));
    act(() => fuel.result.current.setField('odometer', '4000'));
    act(() => fuel.result.current.setField('amount', '30'));
    let res: Awaited<ReturnType<typeof fuel.result.current.submit>> | undefined;
    await act(async () => {
      res = await fuel.result.current.submit();
    });
    expect(res).toEqual({ ok: false, reason: 'warning' });
    await act(async () => {
      res = await fuel.result.current.submit();
    });
    expect(res?.ok).toBe(true);
  });

  it('snooze, clear snooze, delete/restore and deadline completion round-trip', async () => {
    const v = await createVehicle();
    const rule = (await db.reminderRules.where('vehicleId').equals(v.id).toArray()).find((r) => r.itemKey === 'engine_oil')!;

    const snoozed = await snoozeWithUndo(db, rule, { currentOdometer: 3000, today: TODAY });
    let stored = await db.reminderRules.get(rule.id);
    expect(stored?.snoozeUntilOdometer).toBe(3500);
    expect(stored?.snoozeUntilDate).toBe('2026-11-30');
    await snoozed.undo();
    stored = await db.reminderRules.get(rule.id);
    expect(stored?.snoozeUntilOdometer).toBeUndefined();

    await snoozeWithUndo(db, stored!, { currentOdometer: 3000, today: TODAY });
    const snoozedRule = (await db.reminderRules.get(rule.id))!;
    const edit2 = renderHook(() => useReminderRuleForm({ db, vehicle: v, record: snoozedRule, existingKeys: [] }));
    expect(edit2.result.current.snoozed).toBe(true);
    act(() => edit2.result.current.clearSnooze());
    await act(async () => {
      await edit2.result.current.submit();
    });
    const cleared = (await db.reminderRules.get(rule.id))!;
    expect(cleared.snoozeUntilDate).toBeUndefined();
    expect(cleared.snoozeUntilOdometer).toBeUndefined();

    const del = await deleteWithUndo(db, 'reminderRules', rule.id, '提醒');
    expect((await db.reminderRules.get(rule.id))?.deletedAt).toBeDefined();
    await del.undo();
    expect((await db.reminderRules.get(rule.id))?.deletedAt).toBeUndefined();

    const dl = renderHook(() => useDeadlineForm({ db, vehicle: v }));
    act(() => dl.result.current.setField('dueDate', '2026-12-01'));
    let dres: Awaited<ReturnType<typeof dl.result.current.submit>> | undefined;
    await act(async () => {
      dres = await dl.result.current.submit();
    });
    expect(dres?.ok).toBe(true);
    const deadline = dres!.ok ? dres!.record : undefined;
    const done = await completeDeadlineWithUndo(db, deadline!, TODAY);
    expect((await db.deadlines.get(deadline!.id))?.dueDate).toBe('2027-12-01');
    await done.undo();
    expect((await db.deadlines.get(deadline!.id))?.dueDate).toBe('2026-12-01');
  });

  it('JSON export → parse → import round-trips', async () => {
    const v = await createVehicle();
    const snapshot = buildSnapshot(await readAllTables(db));
    const parsed = parseSnapshot(JSON.stringify(snapshot));
    expect(parsed.tables.vehicles.map((x) => x.id)).toEqual([v.id]);

    const other = createDb(`test-integration-import-${Date.now()}-${n++}`);
    try {
      const count = await importRecords(other, parsed.tables);
      expect(count).toBe(1 + parsed.tables.reminderRules.length);
      expect(await other.vehicles.get(v.id)).toBeDefined();
    } finally {
      other.close();
    }
  });
});
