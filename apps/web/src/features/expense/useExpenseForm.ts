import { useCallback } from 'react';
import type { ExpenseCategory, ExpenseRecord } from '@car-record/shared';
import { lastValue, type ReceiptInvoiceFill } from '../../domain';
import { saveRecord, type Draft } from '../../db/repository';
import { compact, formatInputNumber, isBlank } from '../../lib/format';
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

export interface ExpenseFormValues {
  date: string;
  category: ExpenseCategory;
  cost: string;
  /** Optional for expenses. */
  odometer: string;
  note: string;
  recurring: boolean;
  everyMonths: string;
  invoiceNumber: string;
}

export type ApplyExpenseInvoiceResult = { ok: true } | { ok: false; duplicateOf: ExpenseRecord };

export interface UseExpenseFormOptions extends EntryFormContext {
  expenseRecords: ExpenseRecord[];
  record?: ExpenseRecord;
  duplicateOf?: ExpenseRecord;
}

function initialValues(o: UseExpenseFormOptions): ExpenseFormValues {
  const r = o.record;
  if (r) {
    return {
      date: r.date,
      category: r.category,
      cost: formatInputNumber(r.cost),
      odometer: formatInputNumber(r.odometer),
      note: r.note ?? '',
      recurring: r.recurring !== undefined,
      everyMonths: formatInputNumber(r.recurring?.everyMonths ?? 12),
      invoiceNumber: r.invoiceNumber ?? '',
    };
  }
  const d = o.duplicateOf;
  return {
    date: o.today,
    category: d?.category ?? lastValue(o.expenseRecords, 'category') ?? 'other',
    cost: formatInputNumber(d?.cost),
    odometer: '',
    note: d?.note ?? '',
    recurring: d?.recurring !== undefined && d !== undefined,
    everyMonths: formatInputNumber(d?.recurring?.everyMonths ?? 12),
    invoiceNumber: '',
  };
}

export function useExpenseForm(o: UseExpenseFormOptions) {
  const form = useFormState(() => initialValues(o));
  const { values, setValues, setErrors } = form;
  const guard = useOdometerGuard(o.readings, o.record?.id);
  const { saving, run } = useSaving();

  const setField = useCallback(
    <K extends keyof ExpenseFormValues>(key: K, value: ExpenseFormValues[K]) => {
      if (key === 'odometer' || key === 'date') guard.reset();
      form.setField(key, value);
    },
    [form, guard],
  );

  const applyInvoice = useCallback(
    (fill: ReceiptInvoiceFill): ApplyExpenseInvoiceResult => {
      const duplicate = o.expenseRecords.find(
        (r) =>
          (r.deletedAt === undefined || r.deletedAt === null) &&
          r.id !== o.record?.id &&
          r.invoiceNumber === fill.invoiceNumber,
      );
      if (duplicate) return { ok: false, duplicateOf: duplicate };

      setValues((prev) => ({
        ...prev,
        date: fill.date,
        cost: formatInputNumber(fill.total),
        invoiceNumber: fill.invoiceNumber,
        note: fill.note ? (isBlank(prev.note) ? fill.note : `${prev.note}\n${fill.note}`) : prev.note,
      }));
      guard.reset();
      setErrors((prev) => {
        const next = { ...prev };
        delete next.date;
        delete next.cost;
        delete next.note;
        delete next.invoiceNumber;
        return next;
      });
      return { ok: true };
    },
    [o.expenseRecords, o.record?.id, setValues, guard, setErrors],
  );

  const submit = useCallback(async (): Promise<SubmitResult<ExpenseRecord>> => {
    const errors: Record<string, string> = {};
    if (!DATE_RE.test(values.date)) errors.date = '請選擇日期';
    const cost = readNumber(values.cost, 'cost', errors, { required: '請輸入金額' });
    const odometer = readNumber(values.odometer, 'odometer', errors);
    const everyMonths = values.recurring
      ? readNumber(values.everyMonths, 'everyMonths', errors, {
          required: '請輸入整數月數',
          integer: true,
          positive: '請輸入整數月數',
          invalid: '請輸入整數月數',
        })
      : undefined;
    setErrors(errors);
    if (Object.keys(errors).length > 0 || cost === undefined) return { ok: false, reason: 'invalid' };
    if (odometer !== undefined && !guard.allow(odometer, values.date)) return { ok: false, reason: 'warning' };

    const legacyPhotos = o.record?.photoIds && o.record.photoIds.length > 0 ? o.record.photoIds : undefined;
    const draft = compact({
      id: o.record?.id,
      createdAt: o.record?.createdAt,
      vehicleId: o.vehicle.id,
      date: values.date,
      category: values.category,
      cost,
      odometer,
      recurring: everyMonths !== undefined ? { everyMonths } : undefined,
      invoiceNumber: values.invoiceNumber || undefined,
      note: trimOrUndefined(values.note),
      photoIds: legacyPhotos,
    });
    return run(() => saveRecord(o.db, 'expenses', draft as Draft<'expenses'>, o.now?.()));
  }, [values, setErrors, guard, o, run]);

  return {
    values,
    setField,
    applyInvoice,
    errors: form.errors,
    warning: guard.warning,
    dirty: form.dirty,
    saving,
    isEdit: o.record !== undefined,
    odometerPlaceholder: formatInputNumber(o.estimate),
    submit,
  };
}
