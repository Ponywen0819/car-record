import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { FuelRecord, Vehicle } from '@car-record/shared';
import type { CarDB } from '../../db/db';
import type { OdometerReading } from '../../domain';
import * as repo from '../../db/repository';
import { useFuelForm, type UseFuelFormOptions } from './useFuelForm';

vi.mock('../../domain', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('../../test/fakeDomain')).domainFakes,
}));
vi.mock('../../db/repository', () => import('../../test/repoMock'));

const db = {} as CarDB;
const vehicle: Vehicle = { id: 'v1', name: '小白', fuelType: 'gasoline', createdAt: 1, updatedAt: 1 };
const f = (p: Partial<FuelRecord>): FuelRecord => ({
  id: 'f0',
  vehicleId: 'v1',
  date: '2026-11-01',
  odometer: 52000,
  amount: 40,
  isFull: true,
  createdAt: 1,
  updatedAt: 1,
  ...p,
});
const readings: OdometerReading[] = [
  { date: '2026-10-01', odometer: 51000, source: 'fuel', recordId: 'f-old' },
  { date: '2026-11-01', odometer: 52000, source: 'fuel', recordId: 'f0' },
];

function setup(over: Partial<UseFuelFormOptions> = {}) {
  const opts: UseFuelFormOptions = {
    db,
    vehicle,
    readings,
    estimate: 52340,
    today: '2026-11-23',
    fuelRecords: [f({ station: '中油 民生站', grade: '95' }), f({ id: 'f-old', date: '2026-10-01', station: '台塑' })],
    now: () => 5000,
    ...over,
  };
  return renderHook((p: UseFuelFormOptions) => useFuelForm(p), { initialProps: opts });
}

beforeEach(() => vi.clearAllMocks());

describe('useFuelForm defaults', () => {
  it('prefills today, the estimated odometer and the last station / grade', () => {
    const { result } = setup();
    expect(result.current.values).toMatchObject({
      date: '2026-11-23',
      odometer: '52340',
      amount: '',
      unitPrice: '',
      total: '',
      isFull: true,
      station: '中油 民生站',
      grade: '95',
    });
    expect(result.current.isEdit).toBe(false);
    expect(result.current.unit).toBe('L');
    expect(result.current.dirty).toBe(false);
  });

  it('leaves the odometer empty without an estimate and uses kWh for EVs', () => {
    const { result } = setup({ estimate: null, vehicle: { ...vehicle, fuelType: 'ev' } });
    expect(result.current.values.odometer).toBe('');
    expect(result.current.unit).toBe('kWh');
  });
});

describe('price solving', () => {
  it('derives the unit price from total + amount', () => {
    const { result } = setup();
    act(() => result.current.setField('amount', '40'));
    act(() => result.current.setField('total', '1200'));
    expect(result.current.values.unitPrice).toBe('30');
    expect(result.current.derived).toBe('unitPrice');
    expect(result.current.dirty).toBe(true);
  });

  it('re-derives the oldest field when the derived one is typed over', () => {
    const { result } = setup();
    act(() => result.current.setField('amount', '40'));
    act(() => result.current.setField('total', '1200'));
    act(() => result.current.setField('unitPrice', '31'));
    expect(result.current.derived).toBe('amount');
    expect(result.current.values.amount).toBe('38.71');
  });

  it('clears a derived value when one of its inputs is cleared', () => {
    const { result } = setup();
    act(() => result.current.setField('amount', '40'));
    act(() => result.current.setField('unitPrice', '30'));
    expect(result.current.values.total).toBe('1200');
    act(() => result.current.setField('amount', ''));
    expect(result.current.values.total).toBe('');
    expect(result.current.derived).toBeNull();
  });
});

describe('submit', () => {
  it('validates required fields without saving', async () => {
    const { result } = setup({ estimate: null });
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res).toEqual({ ok: false, reason: 'invalid' });
    expect(result.current.errors.odometer).toBe('請輸入里程');
    expect(result.current.errors.amount).toBe('請輸入油量');
    expect(repo.saveRecord).not.toHaveBeenCalled();
  });

  it('rejects malformed numbers', async () => {
    const { result } = setup();
    act(() => result.current.setField('amount', 'abc'));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.errors.amount).toBe('格式不正確');
  });

  it('saves a new fuel record through the repository', async () => {
    const { result } = setup();
    act(() => result.current.setField('odometer', '52,410'));
    act(() => result.current.setField('amount', '40'));
    act(() => result.current.setField('total', '1200'));
    act(() => result.current.setField('note', '  '));
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res?.ok).toBe(true);
    expect(repo.saveRecord).toHaveBeenCalledTimes(1);
    const [, table, draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(table).toBe('fuel');
    expect(draft).toEqual({
      vehicleId: 'v1',
      date: '2026-11-23',
      odometer: 52410,
      amount: 40,
      unitPrice: 30,
      cost: 1200,
      isFull: true,
      station: '中油 民生站',
      grade: '95',
    });
  });

  it('warns when the odometer goes backwards and saves on the second tap', async () => {
    const { result } = setup();
    act(() => result.current.setField('odometer', '51500'));
    act(() => result.current.setField('amount', '30'));
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res).toEqual({ ok: false, reason: 'warning' });
    expect(result.current.warning).toContain('52,000 km');
    expect(repo.saveRecord).not.toHaveBeenCalled();

    await act(async () => {
      res = await result.current.submit();
    });
    expect(res?.ok).toBe(true);
    expect(repo.saveRecord).toHaveBeenCalledTimes(1);
  });

  it('warns again when the odometer is changed after the first warning', async () => {
    const { result } = setup();
    act(() => result.current.setField('odometer', '51500'));
    act(() => result.current.setField('amount', '30'));
    await act(async () => {
      await result.current.submit();
    });
    act(() => result.current.setField('odometer', '51600'));
    expect(result.current.warning).toBeNull();
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res).toEqual({ ok: false, reason: 'warning' });
  });

  it('edits an existing record, keeping id/createdAt and ignoring its own reading', async () => {
    const record = f({ id: 'f0', createdAt: 77, odometer: 52000, amount: 40, unitPrice: 30, cost: 1200, station: 'A', isFull: false });
    const { result } = setup({ record });
    expect(result.current.isEdit).toBe(true);
    expect(result.current.values).toMatchObject({
      date: '2026-11-01',
      odometer: '52000',
      amount: '40',
      unitPrice: '30',
      total: '1200',
      station: 'A',
      isFull: false,
    });
    act(() => result.current.setField('odometer', '51900'));
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res?.ok).toBe(true);
    const [, , draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(draft).toMatchObject({ id: 'f0', createdAt: 77, odometer: 51900 });
  });

  it('duplicates a record with today and the estimated odometer', () => {
    const src = f({ id: 'f0', amount: 35, unitPrice: 29.5, cost: 1033, station: 'B', grade: '98', note: 'x' });
    const { result } = setup({ duplicateOf: src });
    expect(result.current.isEdit).toBe(false);
    expect(result.current.values).toMatchObject({
      date: '2026-11-23',
      odometer: '52340',
      amount: '35',
      unitPrice: '29.5',
      total: '1033',
      station: 'B',
      grade: '98',
    });
  });

  it('reports a repository error', async () => {
    vi.mocked(repo.saveRecord).mockRejectedValueOnce(new Error('boom'));
    const { result } = setup();
    act(() => result.current.setField('amount', '30'));
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res).toEqual({ ok: false, reason: 'error', message: 'boom' });
  });
});

describe('invoice scan', () => {
  const fill = { invoiceNumber: 'QZ87654321', date: '2026-11-20', amount: 30.12, unitPrice: 31.6, total: 952, grade: '98' };

  it('fills date, amount, unit price, total and grade from the scanned invoice', () => {
    const { result } = setup();
    let res: ReturnType<typeof result.current.applyInvoice> | undefined;
    act(() => {
      res = result.current.applyInvoice(fill);
    });
    expect(res).toEqual({ ok: true });
    expect(result.current.values).toMatchObject({
      date: '2026-11-20',
      amount: '30.12',
      unitPrice: '31.6',
      total: '952',
      grade: '98',
      invoiceNumber: 'QZ87654321',
      odometer: '52340',
      station: '中油 民生站',
    });
    expect(result.current.derived).toBeNull();
    expect(result.current.dirty).toBe(true);
  });

  it('keeps the current grade when the invoice does not say', () => {
    const { result } = setup();
    act(() => {
      result.current.applyInvoice({ ...fill, grade: undefined });
    });
    expect(result.current.values.grade).toBe('95');
  });

  it('saves the invoice number with the record', async () => {
    const { result } = setup();
    act(() => {
      result.current.applyInvoice(fill);
    });
    act(() => result.current.setField('odometer', '52410'));
    let res: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      res = await result.current.submit();
    });
    expect(res?.ok).toBe(true);
    const [, , draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(draft).toEqual({
      vehicleId: 'v1',
      date: '2026-11-20',
      odometer: 52410,
      amount: 30.12,
      unitPrice: 31.6,
      cost: 952,
      isFull: true,
      station: '中油 民生站',
      grade: '98',
      invoiceNumber: 'QZ87654321',
    });
  });

  it('refuses an invoice that another fuel record already used', () => {
    const used = f({ id: 'f-used', date: '2026-11-10', invoiceNumber: 'QZ87654321' });
    const { result } = setup({ fuelRecords: [used] });
    let res: ReturnType<typeof result.current.applyInvoice> | undefined;
    act(() => {
      res = result.current.applyInvoice(fill);
    });
    expect(res).toEqual({ ok: false, duplicateOf: used });
    expect(result.current.values.amount).toBe('');
    expect(result.current.values.invoiceNumber).toBe('');
  });

  it('allows re-scanning the invoice of the record being edited, and keeps it on save', async () => {
    const record = f({ id: 'f0', invoiceNumber: 'QZ87654321' });
    const { result } = setup({ record, fuelRecords: [record] });
    expect(result.current.values.invoiceNumber).toBe('QZ87654321');
    let res: ReturnType<typeof result.current.applyInvoice> | undefined;
    act(() => {
      res = result.current.applyInvoice(fill);
    });
    expect(res).toEqual({ ok: true });
    await act(async () => {
      await result.current.submit();
    });
    const [, , draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(draft).toMatchObject({ id: 'f0', invoiceNumber: 'QZ87654321' });
  });

  it('ignores soft-deleted records when checking for duplicates', () => {
    const gone = f({ id: 'f-gone', invoiceNumber: 'QZ87654321', deletedAt: 9 });
    const { result } = setup({ fuelRecords: [gone] });
    let res: ReturnType<typeof result.current.applyInvoice> | undefined;
    act(() => {
      res = result.current.applyInvoice(fill);
    });
    expect(res).toEqual({ ok: true });
  });
});

describe('photos', () => {
  it('no longer has a photo field on the form', () => {
    const { result } = setup();
    expect('photoIds' in result.current.values).toBe(false);
  });

  it('keeps photos already attached to an edited record', async () => {
    const record = f({ id: 'f0', photoIds: ['p1', 'p2'] });
    const { result } = setup({ record });
    await act(async () => {
      await result.current.submit();
    });
    const [, , draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(draft).toMatchObject({ id: 'f0', photoIds: ['p1', 'p2'] });
  });

  it('does not attach photos to a new record', async () => {
    const { result } = setup();
    act(() => result.current.setField('amount', '30'));
    await act(async () => {
      await result.current.submit();
    });
    const [, , draft] = vi.mocked(repo.saveRecord).mock.calls[0]!;
    expect(draft).not.toHaveProperty('photoIds');
  });
});
