import { useCallback, useState } from 'react';
import type { FuelRecord } from '@car-record/shared';
import { lastValue, solvePrice, type PriceInput } from '../../domain';
import { saveRecord, type Draft } from '../../db/repository';
import { compact, formatInputNumber, isBlank, parseDecimal } from '../../lib/format';
import {
  DATE_RE,
  readNumber,
  trimOrUndefined,
  useFormState,
  useOdometerGuard,
  useSaving,
  type EntryFormContext,
  type SubmitResult,
} from '../forms/formKit';

export type PriceField = 'amount' | 'unitPrice' | 'total';
export const PRICE_FIELDS: readonly PriceField[] = ['amount', 'unitPrice', 'total'];

export interface FuelFormValues {
  date: string;
  odometer: string;
  amount: string;
  unitPrice: string;
  total: string;
  isFull: boolean;
  station: string;
  grade: string;
  note: string;
  photoIds: string[];
}

export interface UseFuelFormOptions extends EntryFormContext {
  fuelRecords: FuelRecord[];
  /** Edit this record. */
  record?: FuelRecord;
  /** Prefill from this record (duplicate): date / odometer become today's defaults. */
  duplicateOf?: FuelRecord;
}

interface PriceState {
  /** Most recently typed price fields (max 2); the third is derived. */
  queue: PriceField[];
  derived: PriceField | null;
}

/** Pure: apply an edit to one of amount / unitPrice / total and re-derive the third. */
export function applyPriceEdit(
  values: FuelFormValues,
  state: PriceState,
  field: PriceField,
  raw: string,
): { values: FuelFormValues; state: PriceState } {
  const next = { ...values, [field]: raw };
  let queue = state.queue.filter((f) => f !== field);
  if (!isBlank(raw)) queue = [field, ...queue].slice(0, 2);
  let derived = state.derived === field ? null : state.derived;

  if (queue.length === 2) {
    const target = PRICE_FIELDS.find((f) => !queue.includes(f))!;
    const input: PriceInput = {};
    let usable = true;
    for (const f of queue) {
      const n = parseDecimal(next[f]);
      if (n === undefined || !Number.isFinite(n) || n <= 0) usable = false;
      else input[f] = n;
    }
    if (usable) {
      const solved = solvePrice(input)[target];
      if (solved !== undefined) {
        next[target] = String(solved);
        derived = target;
      }
    } else if (derived) {
      next[derived] = '';
      derived = null;
    }
  } else if (derived) {
    next[derived] = '';
    derived = null;
  }
  return { values: next, state: { queue, derived } };
}

function initialValues(o: UseFuelFormOptions): FuelFormValues {
  const r = o.record;
  if (r) {
    return {
      date: r.date,
      odometer: formatInputNumber(r.odometer),
      amount: formatInputNumber(r.amount),
      unitPrice: formatInputNumber(r.unitPrice),
      total: formatInputNumber(r.cost),
      isFull: r.isFull,
      station: r.station ?? '',
      grade: r.grade ?? '',
      note: r.note ?? '',
      photoIds: r.photoIds ?? [],
    };
  }
  const d = o.duplicateOf;
  return {
    date: o.today,
    odometer: formatInputNumber(o.estimate),
    amount: formatInputNumber(d?.amount),
    unitPrice: formatInputNumber(d?.unitPrice),
    total: formatInputNumber(d?.cost),
    isFull: d?.isFull ?? true,
    station: d?.station ?? lastValue(o.fuelRecords, 'station') ?? '',
    grade: d?.grade ?? lastValue(o.fuelRecords, 'grade') ?? '',
    note: d?.note ?? '',
    photoIds: [],
  };
}

export function useFuelForm(o: UseFuelFormOptions) {
  const form = useFormState(() => initialValues(o));
  const { values, setValues, setErrors } = form;
  const [price, setPrice] = useState<PriceState>(() => ({
    queue: (['total', 'amount', 'unitPrice'] as const).filter((f) => !isBlank(initialValues(o)[f])).slice(0, 2),
    derived: null,
  }));
  const guard = useOdometerGuard(o.readings, o.record?.id);
  const { saving, run } = useSaving();
  const isEv = o.vehicle.fuelType === 'ev';
  const noun = isEv ? '電量' : '油量';

  const setField = useCallback(
    <K extends keyof FuelFormValues>(key: K, value: FuelFormValues[K]) => {
      if (key === 'amount' || key === 'unitPrice' || key === 'total') {
        const res = applyPriceEdit(values, price, key, value as string);
        setValues(res.values);
        setPrice(res.state);
        setErrors((e) => ({ ...e, amount: undefined, unitPrice: undefined, total: undefined }));
        return;
      }
      if (key === 'odometer' || key === 'date') guard.reset();
      form.setField(key, value);
    },
    [values, price, setValues, setErrors, guard, form],
  );

  const submit = useCallback(async (): Promise<SubmitResult<FuelRecord>> => {
    const errors: Record<string, string> = {};
    if (!DATE_RE.test(values.date)) errors.date = '請選擇日期';
    const odometer = readNumber(values.odometer, 'odometer', errors, { required: '請輸入里程' });
    const amount = readNumber(values.amount, 'amount', errors, { required: `請輸入${noun}`, positive: `${noun}需大於 0` });
    const unitPrice = readNumber(values.unitPrice, 'unitPrice', errors);
    const total = readNumber(values.total, 'total', errors);
    setErrors(errors);
    if (Object.keys(errors).length > 0 || odometer === undefined || amount === undefined) {
      return { ok: false, reason: 'invalid' };
    }
    if (!guard.allow(odometer, values.date)) return { ok: false, reason: 'warning' };

    const solved = solvePrice({ amount, unitPrice, total });
    const draft = compact({
      id: o.record?.id,
      createdAt: o.record?.createdAt,
      vehicleId: o.vehicle.id,
      date: values.date,
      odometer,
      amount: solved.amount ?? amount,
      unitPrice: solved.unitPrice,
      cost: solved.total,
      isFull: values.isFull,
      station: trimOrUndefined(values.station),
      grade: trimOrUndefined(values.grade),
      note: trimOrUndefined(values.note),
      photoIds: values.photoIds.length > 0 ? values.photoIds : undefined,
    });
    return run(() => saveRecord(o.db, 'fuel', draft as Draft<'fuel'>, o.now?.()));
  }, [values, noun, setErrors, guard, o, run]);

  return {
    values,
    setField,
    errors: form.errors,
    derived: price.derived,
    warning: guard.warning,
    dirty: form.dirty,
    saving,
    isEdit: o.record !== undefined,
    unit: isEv ? ('kWh' as const) : ('L' as const),
    submit,
  };
}
