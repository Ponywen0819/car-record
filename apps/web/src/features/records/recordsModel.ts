import {
  EXPENSE_CATEGORIES,
  MAINTENANCE_KIND_LABELS,
  maintenanceItemLabel,
  type ExpenseRecord,
  type FuelRecord,
  type FuelType,
  type MaintenanceRecord,
} from '@car-record/shared';
import { formatKm, formatNumber, monthLabel } from '../../lib/format';

export type RecordTable = 'fuel' | 'maintenance' | 'expenses';
export type RecordFilter = 'all' | RecordTable;
export type EntryKind = 'fuel' | 'maintenance' | 'expense';

export type RecordOf<T extends RecordTable> = T extends 'fuel'
  ? FuelRecord
  : T extends 'maintenance'
    ? MaintenanceRecord
    : ExpenseRecord;

export type RecordRow =
  | (RowBase & { table: 'fuel'; record: FuelRecord })
  | (RowBase & { table: 'maintenance'; record: MaintenanceRecord })
  | (RowBase & { table: 'expenses'; record: ExpenseRecord });

interface RowBase {
  id: string;
  date: string;
  createdAt: number;
  title: string;
  detail: string;
  cost?: number;
}

export function tableToFormKind(table: RecordTable): EntryKind {
  return table === 'expenses' ? 'expense' : table;
}

export const TABLE_NOUNS: Record<RecordTable, string> = {
  fuel: '加油紀錄',
  maintenance: '保養紀錄',
  expenses: '費用紀錄',
};

export function recordCost(table: RecordTable, record: FuelRecord | MaintenanceRecord | ExpenseRecord): number | undefined {
  if (record.cost !== undefined) return record.cost;
  if (table === 'fuel') {
    const f = record as FuelRecord;
    if (f.unitPrice !== undefined) return Math.round(f.amount * f.unitPrice);
  }
  return undefined;
}

const categoryName = (key: string) => EXPENSE_CATEGORIES.find((c) => c.key === key)?.label ?? key;

function fuelRow(r: FuelRecord, fuelType: FuelType): RecordRow {
  const ev = fuelType === 'ev';
  const title = `${ev ? '充電' : '加油'} ${formatNumber(r.amount, 2)} ${ev ? 'kWh' : 'L'}${r.isFull ? '' : '（未加滿）'}`;
  return {
    table: 'fuel',
    record: r,
    id: r.id,
    date: r.date,
    createdAt: r.createdAt,
    title,
    detail: [r.station, formatKm(r.odometer)].filter(Boolean).join(' · '),
    cost: recordCost('fuel', r),
  };
}

function maintenanceRow(r: MaintenanceRecord): RecordRow {
  return {
    table: 'maintenance',
    record: r,
    id: r.id,
    date: r.date,
    createdAt: r.createdAt,
    title: r.items.map((i) => maintenanceItemLabel(i.itemKey)).join('、'),
    detail: [MAINTENANCE_KIND_LABELS[r.kind], r.shop, formatKm(r.odometer)].filter(Boolean).join(' · '),
    cost: r.cost,
  };
}

function expenseRow(r: ExpenseRecord): RecordRow {
  return {
    table: 'expenses',
    record: r,
    id: r.id,
    date: r.date,
    createdAt: r.createdAt,
    title: `${categoryName(r.category)}${r.recurring ? ` · 每 ${r.recurring.everyMonths} 個月` : ''}`,
    detail: r.note ?? '',
    cost: r.cost,
  };
}

/** Rows for the records list, newest first (date desc, then createdAt desc). */
export function toRecordRows(
  data: { fuel: FuelRecord[]; maintenance: MaintenanceRecord[]; expenses: ExpenseRecord[] },
  filter: RecordFilter,
  fuelType: FuelType,
): RecordRow[] {
  const rows: RecordRow[] = [];
  const live = <T extends { deletedAt?: number }>(xs: T[]) => xs.filter((x) => x.deletedAt === undefined);
  if (filter === 'all' || filter === 'fuel') rows.push(...live(data.fuel).map((r) => fuelRow(r, fuelType)));
  if (filter === 'all' || filter === 'maintenance') rows.push(...live(data.maintenance).map(maintenanceRow));
  if (filter === 'all' || filter === 'expenses') rows.push(...live(data.expenses).map(expenseRow));
  return rows.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
}

export interface MonthGroup {
  month: string;
  label: string;
  total: number;
  rows: RecordRow[];
}

/** Consecutive month groups (rows must already be sorted). */
export function groupByMonth(rows: RecordRow[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    let g = groups.at(-1);
    if (!g || g.month !== month) {
      g = { month, label: monthLabel(month), total: 0, rows: [] };
      groups.push(g);
    }
    g.rows.push(row);
    g.total += row.cost ?? 0;
  }
  return groups;
}
