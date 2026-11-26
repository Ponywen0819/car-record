import { describe, expect, it } from 'vitest';
import {
  TABLES,
  recordSchemas,
  fuelRecordSchema,
  maintenanceRecordSchema,
  expenseRecordSchema,
  reminderRuleSchema,
  vehicleSchema,
  pushRequestSchema,
  pullResponseSchema,
} from '../schemas';

const base = { id: 'r1', createdAt: 1, updatedAt: 1 };

describe('record schemas', () => {
  it('registers a schema for every table', () => {
    expect([...TABLES].sort()).toEqual(
      ['deadlines', 'expenses', 'fuel', 'maintenance', 'reminderRules', 'vehicles'].sort(),
    );
    for (const t of TABLES) expect(recordSchemas[t]).toBeDefined();
  });

  it('accepts a minimal vehicle', () => {
    expect(vehicleSchema.safeParse({ ...base, name: '我的車', fuelType: 'gasoline' }).success).toBe(true);
  });

  it('rejects an unknown fuel type', () => {
    expect(vehicleSchema.safeParse({ ...base, name: 'x', fuelType: 'steam' }).success).toBe(false);
  });

  it('accepts a valid fuel record and rejects negative odometer / zero amount', () => {
    const ok = { ...base, vehicleId: 'v1', date: '2026-11-23', odometer: 52340, amount: 40.5, isFull: true, cost: 1200 };
    expect(fuelRecordSchema.safeParse(ok).success).toBe(true);
    expect(fuelRecordSchema.safeParse({ ...ok, odometer: -1 }).success).toBe(false);
    expect(fuelRecordSchema.safeParse({ ...ok, amount: 0 }).success).toBe(false);
  });

  it('keeps an optional e-invoice number (2 letters + 8 digits) on fuel records', () => {
    const ok = { ...base, vehicleId: 'v1', date: '2026-11-23', odometer: 52340, amount: 40.5, isFull: true };
    const parsed = fuelRecordSchema.safeParse({ ...ok, invoiceNumber: 'QZ87654321' });
    expect(parsed.success && parsed.data.invoiceNumber).toBe('QZ87654321');
    expect(fuelRecordSchema.safeParse({ ...ok, invoiceNumber: 'QZ8765432' }).success).toBe(false);
    expect(fuelRecordSchema.safeParse({ ...ok, invoiceNumber: 'qz87654321' }).success).toBe(false);
  });

  it('keeps an optional e-invoice number on maintenance and expense records too', () => {
    const maint = { ...base, vehicleId: 'v1', date: '2026-11-23', odometer: 100, kind: 'scheduled', items: [{ itemKey: 'engine_oil' }] };
    const exp = { ...base, vehicleId: 'v1', date: '2026-11-23', category: 'parking', cost: 120 };
    expect(maintenanceRecordSchema.safeParse({ ...maint, invoiceNumber: 'MK13572468' }).success).toBe(true);
    expect(maintenanceRecordSchema.safeParse({ ...maint, invoiceNumber: 'MK1357246' }).success).toBe(false);
    const parsed = expenseRecordSchema.safeParse({ ...exp, invoiceNumber: 'PK24681357' });
    expect(parsed.success && parsed.data.invoiceNumber).toBe('PK24681357');
    expect(expenseRecordSchema.safeParse({ ...exp, invoiceNumber: 'pk24681357' }).success).toBe(false);
  });

  it('requires ISO dates (YYYY-MM-DD)', () => {
    const r = { ...base, vehicleId: 'v1', date: '2026/11/23', odometer: 1, amount: 1, isFull: true };
    expect(fuelRecordSchema.safeParse(r).success).toBe(false);
  });

  it('requires at least one maintenance item', () => {
    const r = { ...base, vehicleId: 'v1', date: '2026-11-23', odometer: 100, kind: 'scheduled', items: [] };
    expect(maintenanceRecordSchema.safeParse(r).success).toBe(false);
    expect(maintenanceRecordSchema.safeParse({ ...r, items: [{ itemKey: 'engine_oil' }] }).success).toBe(true);
  });

  it('requires a reminder rule to have a km or month interval', () => {
    const r = { ...base, vehicleId: 'v1', itemKey: 'engine_oil', label: '機油', enabled: true };
    expect(reminderRuleSchema.safeParse(r).success).toBe(false);
    expect(reminderRuleSchema.safeParse({ ...r, everyKm: 5000 }).success).toBe(true);
    expect(reminderRuleSchema.safeParse({ ...r, everyMonths: 6 }).success).toBe(true);
  });

  it('accepts soft-deleted records', () => {
    expect(vehicleSchema.safeParse({ ...base, name: 'x', fuelType: 'ev', deletedAt: 5 }).success).toBe(true);
  });
});

describe('sync protocol schemas', () => {
  it('validates each mutation against its table schema', () => {
    const good = {
      mutations: [{ mutationId: 'm1', table: 'vehicles', record: { ...base, name: 'x', fuelType: 'diesel' } }],
    };
    expect(pushRequestSchema.safeParse(good).success).toBe(true);
    const bad = { mutations: [{ mutationId: 'm1', table: 'vehicles', record: { ...base } }] };
    expect(pushRequestSchema.safeParse(bad).success).toBe(false);
    const badTable = { mutations: [{ mutationId: 'm1', table: 'nope', record: base }] };
    expect(pushRequestSchema.safeParse(badTable).success).toBe(false);
  });

  it('parses a pull response', () => {
    const res = {
      changes: [{ table: 'vehicles', record: { ...base, name: 'x', fuelType: 'ev', rev: 3 } }],
      cursor: 3,
      hasMore: false,
    };
    expect(pullResponseSchema.safeParse(res).success).toBe(true);
  });
});
