import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FuelRecord, MaintenanceRecord, ReminderRule, Vehicle } from '@car-record/shared';
import { createDb, type CarDB } from '../../db/db';
import type { DeadlineStatus, ReminderStatus } from '../../domain';
import {
  CSV_COLUMNS,
  buildCalendarEvents,
  csvRows,
  exportFileName,
  readAllTables,
  shareOrDownload,
  summarizeTables,
} from './exportModel';

const vehicle: Vehicle = { id: 'v1', name: '小白', fuelType: 'gasoline', createdAt: 1, updatedAt: 1 };

describe('csvRows', () => {
  it('flattens fuel records with the vehicle name', () => {
    const rec: FuelRecord = { id: 'f1', vehicleId: 'v1', date: '2026-11-01', odometer: 52000, amount: 40, unitPrice: 30, cost: 1200, isFull: true, station: '中油', createdAt: 1, updatedAt: 1 };
    const [row] = csvRows('fuel', [rec], [vehicle]);
    expect(row).toMatchObject({ vehicle: '小白', date: '2026-11-01', odometer: 52000, amount: 40, isFull: '是', station: '中油', cost: 1200 });
  });

  it('flattens maintenance items and kind labels', () => {
    const rec: MaintenanceRecord = {
      id: 'm1',
      vehicleId: 'v1',
      date: '2026-11-01',
      odometer: 52000,
      kind: 'diy',
      items: [{ itemKey: 'engine_oil', cost: 800 }, { itemKey: 'wipers' }],
      createdAt: 1,
      updatedAt: 1,
    };
    const [row] = csvRows('maintenance', [rec], [vehicle]);
    expect(row).toMatchObject({ kind: '自行 DIY', items: '機油($800)、雨刷' });
  });

  it('has zh-TW headers for each table', () => {
    expect(CSV_COLUMNS.fuel.map((c) => c.header)).toContain('日期');
    expect(Object.keys(CSV_COLUMNS)).toEqual(['fuel', 'maintenance', 'expenses', 'vehicles', 'reminderRules', 'deadlines']);
  });
});

const rule: ReminderRule = { id: 'r1', vehicleId: 'v1', itemKey: 'engine_oil', label: '機油', everyKm: 5000, enabled: true, createdAt: 1, updatedAt: 1 };

describe('buildCalendarEvents', () => {
  it('creates events for reminders with an estimated date and for deadlines', () => {
    const reminders: ReminderStatus[] = [
      { rule, level: 'soon', progress: 0.9, snoozed: false, estimatedDueDate: '2026-12-20', dueOdometer: 57000 },
      { rule: { ...rule, id: 'r2' }, level: 'unknown', progress: 0, snoozed: false },
    ];
    const deadlines: DeadlineStatus[] = [
      {
        deadline: { id: 'd1', vehicleId: 'v1', kind: 'insurance', label: '保險', dueDate: '2027-01-01', remindDaysBefore: 30, createdAt: 1, updatedAt: 1 },
        remainingDays: 39,
        level: 'ok',
      },
    ];
    expect(buildCalendarEvents(vehicle, reminders, deadlines)).toEqual([
      {
        uid: 'reminder-r1@car-record',
        title: '小白：機油 保養到期',
        date: '2026-12-20',
        description: '預估到期里程 57,000 km',
        alarmDaysBefore: 7,
      },
      { uid: 'deadline-d1@car-record', title: '小白：保險 到期', date: '2027-01-01', description: undefined, alarmDaysBefore: 30 },
    ]);
  });
});

describe('exportFileName', () => {
  it('names files by content and date', () => {
    expect(exportFileName('backup', 'json', '2026-11-23')).toBe('car-record-backup-2026-11-23.json');
  });
});

describe('summarizeTables', () => {
  it('counts records per table', () => {
    const s = summarizeTables({ vehicles: [vehicle], fuel: [], maintenance: [], expenses: [], reminderRules: [rule], deadlines: [] });
    expect(s.total).toBe(2);
    expect(s.text).toBe('車輛 1、提醒規則 1');
  });
});

describe('readAllTables', () => {
  let db: CarDB;
  afterEach(() => db.close());
  it('reads every table, skipping soft-deleted records', async () => {
    db = createDb(`test-export-${Date.now()}`);
    await db.vehicles.bulkPut([vehicle, { ...vehicle, id: 'v2', deletedAt: 5 }]);
    await db.reminderRules.put(rule);
    const tables = await readAllTables(db);
    expect(tables.vehicles.map((v) => v.id)).toEqual(['v1']);
    expect(tables.reminderRules).toHaveLength(1);
    expect(tables.fuel).toEqual([]);
  });
});

describe('shareOrDownload', () => {
  const file = new File(['{}'], 'a.json', { type: 'application/json' });

  it('uses the share sheet when files can be shared', async () => {
    const share = vi.fn(async () => {});
    const nav = { canShare: () => true, share } as unknown as Navigator;
    expect(await shareOrDownload(file, nav)).toBe('shared');
    expect(share).toHaveBeenCalledWith({ files: [file], title: 'a.json' });
  });

  it('reports a cancelled share', async () => {
    const err = Object.assign(new Error('cancel'), { name: 'AbortError' });
    const nav = { canShare: () => true, share: vi.fn(async () => Promise.reject(err)) } as unknown as Navigator;
    expect(await shareOrDownload(file, nav)).toBe('cancelled');
  });

  it('falls back to a download link', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(await shareOrDownload(file, {} as Navigator)).toBe('downloaded');
    expect(click).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledWith(file);
    click.mockRestore();
  });
});
