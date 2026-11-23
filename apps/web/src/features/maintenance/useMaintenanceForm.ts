import { useCallback, useMemo } from 'react';
import {
  maintenanceItemLabel,
  maintenanceItemsFor,
  type MaintenanceKind,
  type MaintenanceRecord,
} from '@car-record/shared';
import { dueItemKeys, lastValue, type ReminderStatus } from '../../domain';
import { saveRecord, type Draft } from '../../db/repository';
import { compact, formatInputNumber } from '../../lib/format';
import type { ChipOption } from '../../components/ChipSelect';
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

export interface MaintenanceFormValues {
  date: string;
  odometer: string;
  kind: MaintenanceKind;
  items: string[];
  /** Optional per-item cost (raw input) keyed by itemKey. */
  itemCosts: Record<string, string>;
  /** Total cost (raw input); when blank the item costs are summed. */
  cost: string;
  shop: string;
  note: string;
  photoIds: string[];
}

export interface UseMaintenanceFormOptions extends EntryFormContext {
  maintenanceRecords: MaintenanceRecord[];
  reminderStatuses: ReminderStatus[];
  record?: MaintenanceRecord;
  duplicateOf?: MaintenanceRecord;
  /** Items to preselect (e.g. from a reminder swipe); defaults to the due items. */
  preselect?: string[];
}

function initialValues(o: UseMaintenanceFormOptions, dueKeys: string[]): MaintenanceFormValues {
  const r = o.record;
  if (r) {
    return {
      date: r.date,
      odometer: formatInputNumber(r.odometer),
      kind: r.kind,
      items: r.items.map((i) => i.itemKey),
      itemCosts: Object.fromEntries(
        r.items.filter((i) => i.cost !== undefined).map((i) => [i.itemKey, formatInputNumber(i.cost)]),
      ),
      cost: formatInputNumber(r.cost),
      shop: r.shop ?? '',
      note: r.note ?? '',
      photoIds: r.photoIds ?? [],
    };
  }
  const d = o.duplicateOf;
  return {
    date: o.today,
    odometer: formatInputNumber(o.estimate),
    kind: d?.kind ?? 'scheduled',
    items: o.preselect ?? d?.items.map((i) => i.itemKey) ?? dueKeys,
    itemCosts: d
      ? Object.fromEntries(d.items.filter((i) => i.cost !== undefined).map((i) => [i.itemKey, formatInputNumber(i.cost)]))
      : {},
    cost: formatInputNumber(d?.cost),
    shop: d?.shop ?? lastValue(o.maintenanceRecords, 'shop') ?? '',
    note: d?.note ?? '',
    photoIds: [],
  };
}

export function useMaintenanceForm(o: UseMaintenanceFormOptions) {
  const dueKeys = useMemo(() => dueItemKeys(o.reminderStatuses), [o.reminderStatuses]);
  const form = useFormState(() => initialValues(o, dueKeys));
  const { values, setValues, setErrors } = form;
  const guard = useOdometerGuard(o.readings, o.record?.id);
  const { saving, run } = useSaving();

  const itemOptions = useMemo<ChipOption[]>(() => {
    const base = maintenanceItemsFor(o.vehicle.fuelType).map((i) => ({ value: i.key, label: i.label }));
    const extra = values.items
      .filter((k) => !base.some((b) => b.value === k))
      .map((k) => ({ value: k, label: maintenanceItemLabel(k) }));
    return [...base, ...extra];
  }, [o.vehicle.fuelType, values.items]);

  const setField = useCallback(
    <K extends keyof MaintenanceFormValues>(key: K, value: MaintenanceFormValues[K]) => {
      if (key === 'odometer' || key === 'date') guard.reset();
      form.setField(key, value);
    },
    [form, guard],
  );

  const toggleItem = useCallback(
    (key: string) => {
      setValues((prev) => ({
        ...prev,
        items: prev.items.includes(key) ? prev.items.filter((k) => k !== key) : [...prev.items, key],
      }));
      setErrors((e) => ({ ...e, items: undefined }));
    },
    [setValues, setErrors],
  );

  const setItemCost = useCallback(
    (key: string, raw: string) => setValues((prev) => ({ ...prev, itemCosts: { ...prev.itemCosts, [key]: raw } })),
    [setValues],
  );

  const submit = useCallback(async (): Promise<SubmitResult<MaintenanceRecord>> => {
    const errors: Record<string, string> = {};
    if (!DATE_RE.test(values.date)) errors.date = '請選擇日期';
    const odometer = readNumber(values.odometer, 'odometer', errors, { required: '請輸入里程' });
    if (values.items.length === 0) errors.items = '請至少選擇一個項目';
    const items = values.items.map((itemKey) => {
      const cost = readNumber(values.itemCosts[itemKey] ?? '', `itemCost.${itemKey}`, errors);
      return cost === undefined ? { itemKey } : { itemKey, cost };
    });
    let cost = readNumber(values.cost, 'cost', errors);
    setErrors(errors);
    if (Object.keys(errors).length > 0 || odometer === undefined) return { ok: false, reason: 'invalid' };
    if (!guard.allow(odometer, values.date)) return { ok: false, reason: 'warning' };

    if (cost === undefined && items.some((i) => i.cost !== undefined)) {
      cost = items.reduce((sum, i) => sum + (i.cost ?? 0), 0);
    }
    const draft = compact({
      id: o.record?.id,
      createdAt: o.record?.createdAt,
      vehicleId: o.vehicle.id,
      date: values.date,
      odometer,
      kind: values.kind,
      shop: trimOrUndefined(values.shop),
      items,
      cost,
      note: trimOrUndefined(values.note),
      photoIds: values.photoIds.length > 0 ? values.photoIds : undefined,
    });
    return run(() => saveRecord(o.db, 'maintenance', draft as Draft<'maintenance'>, o.now?.()));
  }, [values, setErrors, guard, o, run]);

  const itemsTotal = useMemo(() => {
    let sum = 0;
    let any = false;
    for (const k of values.items) {
      const raw = values.itemCosts[k];
      if (!raw) continue;
      const n = Number(raw.replace(/,/g, ''));
      if (Number.isFinite(n)) {
        sum += n;
        any = true;
      }
    }
    return any ? sum : null;
  }, [values.items, values.itemCosts]);

  return {
    values,
    setField,
    toggleItem,
    setItemCost,
    itemOptions,
    dueKeys,
    itemsTotal,
    errors: form.errors,
    warning: guard.warning,
    dirty: form.dirty,
    saving,
    isEdit: o.record !== undefined,
    submit,
  };
}
