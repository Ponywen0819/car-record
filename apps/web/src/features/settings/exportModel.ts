import {
  DEADLINE_KINDS,
  EXPENSE_CATEGORIES,
  FUEL_TYPE_LABELS,
  MAINTENANCE_KIND_LABELS,
  TABLES,
  maintenanceItemLabel,
  type AnyRecord,
  type Deadline,
  type ExpenseRecord,
  type FuelRecord,
  type MaintenanceRecord,
  type ReminderRule,
  type TableName,
  type Vehicle,
} from '@car-record/shared';
import type { CalendarEvent, DeadlineStatus, ExportSnapshot, ReminderStatus } from '../../domain';
import type { CarDB } from '../../db/db';
import { formatKm } from '../../lib/format';

export type Column = { key: string; header: string };

export const TABLE_LABELS: Record<TableName, string> = {
  vehicles: '車輛',
  maintenance: '保養',
  fuel: '加油',
  expenses: '費用',
  reminderRules: '提醒規則',
  deadlines: '到期提醒',
};

const base: Column[] = [
  { key: 'vehicle', header: '車輛' },
  { key: 'date', header: '日期' },
];

export const CSV_COLUMNS: Record<'fuel' | 'maintenance' | 'expenses' | 'vehicles' | 'reminderRules' | 'deadlines', Column[]> = {
  fuel: [
    ...base,
    { key: 'odometer', header: '里程(km)' },
    { key: 'amount', header: '油量/電量' },
    { key: 'unitPrice', header: '單價' },
    { key: 'cost', header: '總價' },
    { key: 'isFull', header: '加滿' },
    { key: 'station', header: '加油站' },
    { key: 'grade', header: '油品' },
    { key: 'note', header: '備註' },
    { key: 'id', header: 'ID' },
  ],
  maintenance: [
    ...base,
    { key: 'odometer', header: '里程(km)' },
    { key: 'kind', header: '類型' },
    { key: 'items', header: '項目' },
    { key: 'shop', header: '保養廠' },
    { key: 'cost', header: '費用' },
    { key: 'note', header: '備註' },
    { key: 'id', header: 'ID' },
  ],
  expenses: [
    ...base,
    { key: 'category', header: '分類' },
    { key: 'cost', header: '金額' },
    { key: 'odometer', header: '里程(km)' },
    { key: 'recurring', header: '週期(月)' },
    { key: 'note', header: '備註' },
    { key: 'id', header: 'ID' },
  ],
  vehicles: [
    { key: 'name', header: '名稱' },
    { key: 'plate', header: '車牌' },
    { key: 'brand', header: '品牌' },
    { key: 'model', header: '車型' },
    { key: 'year', header: '年份' },
    { key: 'fuelType', header: '燃料' },
    { key: 'vin', header: 'VIN' },
    { key: 'purchaseDate', header: '購車日期' },
    { key: 'purchaseOdometer', header: '購車里程' },
    { key: 'purchasePrice', header: '購車價格' },
    { key: 'id', header: 'ID' },
  ],
  reminderRules: [
    { key: 'vehicle', header: '車輛' },
    { key: 'label', header: '項目' },
    { key: 'everyKm', header: '每幾 km' },
    { key: 'everyMonths', header: '每幾個月' },
    { key: 'enabled', header: '啟用' },
    { key: 'id', header: 'ID' },
  ],
  deadlines: [
    { key: 'vehicle', header: '車輛' },
    { key: 'kind', header: '類型' },
    { key: 'label', header: '名稱' },
    { key: 'dueDate', header: '到期日' },
    { key: 'remindDaysBefore', header: '提前天數' },
    { key: 'repeatEveryMonths', header: '每幾個月' },
    { key: 'note', header: '備註' },
    { key: 'id', header: 'ID' },
  ],
};

const yesNo = (b: boolean) => (b ? '是' : '否');

/** Flatten records into CSV-friendly rows (labels instead of keys). */
export function csvRows(table: TableName, records: AnyRecord[], vehicles: Vehicle[]): Record<string, unknown>[] {
  const vName = (id: string) => vehicles.find((v) => v.id === id)?.name ?? id;
  return records.map((rec) => {
    switch (table) {
      case 'fuel': {
        const r = rec as FuelRecord;
        return { ...r, vehicle: vName(r.vehicleId), isFull: yesNo(r.isFull) };
      }
      case 'maintenance': {
        const r = rec as MaintenanceRecord;
        return {
          ...r,
          vehicle: vName(r.vehicleId),
          kind: MAINTENANCE_KIND_LABELS[r.kind],
          items: r.items.map((i) => `${maintenanceItemLabel(i.itemKey)}${i.cost !== undefined ? `($${i.cost})` : ''}`).join('、'),
        };
      }
      case 'expenses': {
        const r = rec as ExpenseRecord;
        return {
          ...r,
          vehicle: vName(r.vehicleId),
          category: EXPENSE_CATEGORIES.find((c) => c.key === r.category)?.label ?? r.category,
          recurring: r.recurring?.everyMonths,
        };
      }
      case 'vehicles': {
        const r = rec as Vehicle;
        return { ...r, fuelType: FUEL_TYPE_LABELS[r.fuelType] };
      }
      case 'reminderRules': {
        const r = rec as ReminderRule;
        return { ...r, vehicle: vName(r.vehicleId), enabled: yesNo(r.enabled) };
      }
      case 'deadlines': {
        const r = rec as Deadline;
        return { ...r, vehicle: vName(r.vehicleId), kind: DEADLINE_KINDS.find((k) => k.key === r.kind)?.label ?? r.kind };
      }
    }
  });
}

/** Calendar events for reminders that have a (estimated) due date and for deadlines. */
export function buildCalendarEvents(
  vehicle: Vehicle,
  reminders: ReminderStatus[],
  deadlines: DeadlineStatus[],
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const r of reminders) {
    const date = r.estimatedDueDate ?? r.dueDate;
    if (!date) continue;
    events.push({
      uid: `reminder-${r.rule.id}@car-record`,
      title: `${vehicle.name}：${r.rule.label} 保養到期`,
      date,
      description: r.dueOdometer !== undefined ? `預估到期里程 ${formatKm(r.dueOdometer)}` : undefined,
      alarmDaysBefore: 7,
    });
  }
  for (const d of deadlines) {
    events.push({
      uid: `deadline-${d.deadline.id}@car-record`,
      title: `${vehicle.name}：${d.deadline.label} 到期`,
      date: d.deadline.dueDate,
      description: d.deadline.note,
      alarmDaysBefore: d.deadline.remindDaysBefore,
    });
  }
  return events;
}

export function exportFileName(what: string, ext: string, today: string): string {
  return `car-record-${what}-${today}.${ext}`;
}

/** Active (non-deleted) records of every table, straight from the cache. */
export async function readAllTables(db: CarDB): Promise<ExportSnapshot['tables']> {
  const out = {} as Record<TableName, AnyRecord[]>;
  for (const t of TABLES) {
    const rows = (await db.table(t).toArray()) as AnyRecord[];
    out[t] = rows.filter((r) => r.deletedAt === undefined);
  }
  return out as ExportSnapshot['tables'];
}

export function summarizeTables(tables: Partial<ExportSnapshot['tables']>): { total: number; text: string } {
  let total = 0;
  const parts: string[] = [];
  for (const t of TABLES) {
    const n = tables[t]?.length ?? 0;
    total += n;
    if (n > 0) parts.push(`${TABLE_LABELS[t]} ${n}`);
  }
  return { total, text: parts.join('、') };
}

/**
 * iOS: the share sheet is the reliable way to save/export from a standalone PWA
 * (SPEC §6: .ics downloads may not work). Falls back to an <a download>.
 */
export async function shareOrDownload(
  file: File,
  nav: Navigator = navigator,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (typeof nav.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name });
      return 'shared';
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
      // fall through to download (e.g. NotAllowedError without a user gesture)
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
