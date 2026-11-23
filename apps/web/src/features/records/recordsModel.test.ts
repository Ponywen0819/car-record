import { describe, expect, it } from 'vitest';
import type { ExpenseRecord, FuelRecord, MaintenanceRecord } from '@car-record/shared';
import { groupByMonth, recordCost, tableToFormKind, toRecordRows } from './recordsModel';

const fuel: FuelRecord[] = [
  { id: 'f1', vehicleId: 'v1', date: '2026-11-20', odometer: 52000, amount: 40, unitPrice: 30, isFull: true, station: '中油', createdAt: 5, updatedAt: 5 },
  { id: 'f2', vehicleId: 'v1', date: '2026-10-02', odometer: 51000, amount: 35.5, cost: 1000, isFull: false, createdAt: 1, updatedAt: 1 },
  { id: 'f3', vehicleId: 'v1', date: '2026-10-03', odometer: 51100, amount: 30, isFull: true, createdAt: 1, updatedAt: 1, deletedAt: 9 },
];
const maintenance: MaintenanceRecord[] = [
  {
    id: 'm1',
    vehicleId: 'v1',
    date: '2026-11-20',
    odometer: 52000,
    kind: 'scheduled',
    shop: '阿明',
    items: [{ itemKey: 'engine_oil' }, { itemKey: 'oil_filter' }],
    cost: 1500,
    createdAt: 9,
    updatedAt: 9,
  },
];
const expenses: ExpenseRecord[] = [
  { id: 'e1', vehicleId: 'v1', date: '2026-10-15', category: 'parking', cost: 200, note: '機場', createdAt: 1, updatedAt: 1 },
];

describe('toRecordRows', () => {
  it('merges tables newest first, skipping deleted records', () => {
    const rows = toRecordRows({ fuel, maintenance, expenses }, 'all', 'gasoline');
    expect(rows.map((r) => r.id)).toEqual(['m1', 'f1', 'e1', 'f2']);
  });

  it('filters by segment', () => {
    expect(toRecordRows({ fuel, maintenance, expenses }, 'fuel', 'gasoline').map((r) => r.id)).toEqual(['f1', 'f2']);
    expect(toRecordRows({ fuel, maintenance, expenses }, 'expenses', 'gasoline').map((r) => r.id)).toEqual(['e1']);
  });

  it('builds readable titles and details', () => {
    const rows = toRecordRows({ fuel, maintenance, expenses }, 'all', 'gasoline');
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.f1).toMatchObject({ title: '加油 40 L', detail: '中油 · 52,000 km', cost: 1200 });
    expect(byId.f2).toMatchObject({ title: '加油 35.5 L（未加滿）', detail: '51,000 km', cost: 1000 });
    expect(byId.m1).toMatchObject({ title: '機油、機油芯', detail: '定期保養 · 阿明 · 52,000 km', cost: 1500 });
    expect(byId.e1).toMatchObject({ title: '停車', detail: '機場', cost: 200 });
  });

  it('uses charging wording for EVs', () => {
    const rows = toRecordRows({ fuel: [fuel[0]!], maintenance: [], expenses: [] }, 'all', 'ev');
    expect(rows[0]!.title).toBe('充電 40 kWh');
  });
});

describe('groupByMonth', () => {
  it('groups rows by month with totals', () => {
    const groups = groupByMonth(toRecordRows({ fuel, maintenance, expenses }, 'all', 'gasoline'));
    expect(groups.map((g) => [g.month, g.label, g.total, g.rows.length])).toEqual([
      ['2026-11', '2026 年 11 月', 2700, 2],
      ['2026-10', '2026 年 10 月', 1200, 2],
    ]);
  });
});

describe('helpers', () => {
  it('derives fuel cost from amount × unit price', () => {
    expect(recordCost('fuel', fuel[0]!)).toBe(1200);
    expect(recordCost('expenses', expenses[0]!)).toBe(200);
  });
  it('maps tables to form kinds', () => {
    expect(tableToFormKind('expenses')).toBe('expense');
    expect(tableToFormKind('fuel')).toBe('fuel');
  });
});
