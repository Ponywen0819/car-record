import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ExpenseRecord, Vehicle } from '@car-record/shared';
import type { CarDB } from '../../db/db';
import * as repo from '../../db/repository';
import { useExpenseForm, type UseExpenseFormOptions } from './useExpenseForm';

vi.mock('../../domain', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('../../test/fakeDomain')).domainFakes,
}));
vi.mock('../../db/repository', () => import('../../test/repoMock'));

const db = {} as CarDB;
const vehicle: Vehicle = { id: 'v1', name: '小白', fuelType: 'gasoline', createdAt: 1, updatedAt: 1 };
const e = (p: Partial<ExpenseRecord>): ExpenseRecord => ({
  id: 'e0',
  vehicleId: 'v1',
  date: '2026-10-01',
  category: 'parking',
  cost: 100,
  createdAt: 1,
  updatedAt: 1,
  ...p,
});

function setup(over: Partial<UseExpenseFormOptions> = {}) {
  const opts: UseExpenseFormOptions = {
    db,
    vehicle,
    readings: [{ date: '2026-11-01', odometer: 52000, source: 'fuel', recordId: 'f1' }],
    estimate: 52340,
    today: '2026-11-23',
    expenseRecords: [e({ category: 'toll' })],
    ...over,
  };
  return renderHook((p: UseExpenseFormOptions) => useExpenseForm(p), { initialProps: opts });
}

beforeEach(() => vi.clearAllMocks());

describe('useExpenseForm', () => {
  it('defaults to today, the last used category and an empty odometer', () => {
    const { result } = setup();
    expect(result.current.values).toMatchObject({
      date: '2026-11-23',
      category: 'toll',
      cost: '',
      odometer: '',
      recurring: false,
    });
    expect(result.current.odometerPlaceholder).toBe('52340');
  });

  it('falls back to 其他 without history', () => {
    const { result } = setup({ expenseRecords: [] });
    expect(result.current.values.category).toBe('other');
  });

  it('requires a cost and a valid recurring interval', async () => {
    const { result } = setup();
    act(() => result.current.setField('recurring', true));
    act(() => result.current.setField('everyMonths', '1.5'));
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res).toEqual({ ok: false, reason: 'invalid' });
    expect(result.current.errors.cost).toBe('請輸入金額');
    expect(result.current.errors.everyMonths).toBe('請輸入整數月數');
  });

  it('saves a recurring expense', async () => {
    const { result } = setup();
    act(() => result.current.setField('category', 'insurance'));
    act(() => result.current.setField('cost', '12,000'));
    act(() => result.current.setField('recurring', true));
    act(() => result.current.setField('everyMonths', '12'));
    act(() => result.current.setField('note', '任意險'));
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res?.ok).toBe(true);
    const [, table, draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(table).toBe('expenses');
    expect(draft).toEqual({
      vehicleId: 'v1',
      date: '2026-11-23',
      category: 'insurance',
      cost: 12000,
      recurring: { everyMonths: 12 },
      note: '任意險',
    });
  });

  it('checks the odometer only when one is entered', async () => {
    const { result } = setup();
    act(() => result.current.setField('cost', '50'));
    act(() => result.current.setField('odometer', '100'));
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res).toEqual({ ok: false, reason: 'warning' });
  });

  it('edits an existing expense', async () => {
    const { result } = setup({ record: e({ id: 'e5', createdAt: 5, cost: 300, recurring: { everyMonths: 1 }, odometer: 51000 }) });
    expect(result.current.values).toMatchObject({ cost: '300', recurring: true, everyMonths: '1', odometer: '51000', category: 'parking' });
    act(() => result.current.setField('recurring', false));
    await act(async () => {
      await result.current.submit();
    });
    const [, , draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(draft).toMatchObject({ id: 'e5', createdAt: 5, cost: 300 });
    expect(draft).not.toHaveProperty('recurring');
  });
});

describe('invoice scan', () => {
  const fill = { invoiceNumber: 'PK24681357', date: '2026-11-21', total: 120, note: '停車費 ×3 40元' };

  it('fills the date, the amount and the note from the invoice, keeping the category', () => {
    const { result } = setup();
    let res: ReturnType<typeof result.current.applyInvoice> | undefined;
    act(() => {
      res = result.current.applyInvoice(fill);
    });
    expect(res).toEqual({ ok: true });
    expect(result.current.values).toMatchObject({
      date: '2026-11-21',
      cost: '120',
      note: '停車費 ×3 40元',
      invoiceNumber: 'PK24681357',
      category: 'toll',
    });
  });

  it('appends the item list to an existing note', () => {
    const { result } = setup();
    act(() => result.current.setField('note', '公司聚餐'));
    act(() => {
      result.current.applyInvoice(fill);
    });
    expect(result.current.values.note).toBe('公司聚餐\n停車費 ×3 40元');
  });

  it('saves the invoice number with the record', async () => {
    const { result } = setup();
    act(() => {
      result.current.applyInvoice(fill);
    });
    await act(async () => {
      await result.current.submit();
    });
    const [, table, draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(table).toBe('expenses');
    expect(draft).toMatchObject({ date: '2026-11-21', cost: 120, note: '停車費 ×3 40元', invoiceNumber: 'PK24681357' });
  });

  it('refuses an invoice already used by another expense', () => {
    const used = e({ id: 'e-used', date: '2026-11-05', invoiceNumber: 'PK24681357' });
    const { result } = setup({ expenseRecords: [used] });
    let res: ReturnType<typeof result.current.applyInvoice> | undefined;
    act(() => {
      res = result.current.applyInvoice(fill);
    });
    expect(res).toEqual({ ok: false, duplicateOf: used });
    expect(result.current.values.cost).toBe('');
  });
});

describe('photos', () => {
  it('no longer has a photo field on the form', () => {
    const { result } = setup();
    expect('photoIds' in result.current.values).toBe(false);
  });

  it('keeps photos already attached to an edited expense', async () => {
    const record = e({ id: 'e0', photoIds: ['p1'] });
    const { result } = setup({ record });
    await act(async () => {
      await result.current.submit();
    });
    expect(vi.mocked(repo.saveRecord).mock.calls[0]![2]).toMatchObject({ id: 'e0', photoIds: ['p1'] });
  });
});
