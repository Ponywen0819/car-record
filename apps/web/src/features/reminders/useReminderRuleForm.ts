import { useCallback, useMemo, useState } from 'react';
import { MAINTENANCE_ITEMS, maintenanceItemLabel, maintenanceItemsFor, type ReminderRule, type Vehicle } from '@car-record/shared';
import { saveRecord, type Draft } from '../../db/repository';
import type { CarDB } from '../../db/db';
import { compact, formatInputNumber, isBlank } from '../../lib/format';
import { readNumber, useFormState, useSaving, type SubmitResult } from '../forms/formKit';

export interface ReminderRuleFormValues {
  itemKey: string;
  label: string;
  everyKm: string;
  everyMonths: string;
  enabled: boolean;
}

export interface UseReminderRuleFormOptions {
  db: CarDB;
  vehicle: Vehicle;
  record?: ReminderRule;
  /** itemKeys that already have a rule (to suggest a new one). */
  existingKeys: string[];
  now?: () => number;
}

function defaultsFor(itemKey: string) {
  const def = MAINTENANCE_ITEMS.find((i) => i.key === itemKey);
  return {
    label: def?.label ?? maintenanceItemLabel(itemKey),
    everyKm: formatInputNumber(def?.defaultEveryKm),
    everyMonths: formatInputNumber(def?.defaultEveryMonths),
  };
}

function initialValues(o: UseReminderRuleFormOptions): ReminderRuleFormValues {
  const r = o.record;
  if (r) {
    return {
      itemKey: r.itemKey,
      label: r.label,
      everyKm: formatInputNumber(r.everyKm),
      everyMonths: formatInputNumber(r.everyMonths),
      enabled: r.enabled,
    };
  }
  const items = maintenanceItemsFor(o.vehicle.fuelType);
  const first = items.find((i) => !o.existingKeys.includes(i.key)) ?? items[0];
  const key = first?.key ?? 'other';
  return { itemKey: key, ...defaultsFor(key), enabled: true };
}

export function useReminderRuleForm(o: UseReminderRuleFormOptions) {
  const form = useFormState(() => initialValues(o));
  const { values, setValues, setErrors } = form;
  const [labelEdited, setLabelEdited] = useState(o.record !== undefined);
  const [snoozeCleared, setSnoozeCleared] = useState(false);
  const { saving, run } = useSaving();

  const itemOptions = useMemo(
    () => maintenanceItemsFor(o.vehicle.fuelType).map((i) => ({ value: i.key, label: i.label })),
    [o.vehicle.fuelType],
  );

  const setField = useCallback(
    <K extends keyof ReminderRuleFormValues>(key: K, value: ReminderRuleFormValues[K]) => {
      if (key === 'label') setLabelEdited(true);
      form.setField(key, value);
    },
    [form],
  );

  const selectItem = useCallback(
    (itemKey: string) => {
      const d = defaultsFor(itemKey);
      setValues((prev) => ({
        ...prev,
        itemKey,
        ...(labelEdited ? {} : { label: d.label }),
        ...(o.record ? {} : { everyKm: d.everyKm, everyMonths: d.everyMonths }),
      }));
    },
    [setValues, labelEdited, o.record],
  );

  const submit = useCallback(async (): Promise<SubmitResult<ReminderRule>> => {
    const errors: Record<string, string> = {};
    if (isBlank(values.label)) errors.label = '請輸入名稱';
    const everyKm = readNumber(values.everyKm, 'everyKm', errors, { positive: '需大於 0' });
    const everyMonths = readNumber(values.everyMonths, 'everyMonths', errors, {
      integer: true,
      positive: '請輸入整數月數',
      invalid: '請輸入整數月數',
    });
    if (!errors.everyKm && !errors.everyMonths && everyKm === undefined && everyMonths === undefined) {
      errors.everyKm = '里程或月數至少填一個';
    }
    setErrors(errors);
    if (Object.keys(errors).length > 0) return { ok: false, reason: 'invalid' };

    const keepSnooze = o.record !== undefined && !snoozeCleared;
    const draft = {
      ...compact({
        id: o.record?.id,
        createdAt: o.record?.createdAt,
        vehicleId: o.vehicle.id,
        itemKey: values.itemKey,
        label: values.label.trim(),
        everyKm,
        everyMonths,
        enabled: values.enabled,
      }),
      // Explicit keys so clearing a snooze also works with merge-style updates.
      snoozeUntilDate: keepSnooze ? o.record?.snoozeUntilDate : undefined,
      snoozeUntilOdometer: keepSnooze ? o.record?.snoozeUntilOdometer : undefined,
    };
    return run(() => saveRecord(o.db, 'reminderRules', draft as Draft<'reminderRules'>, o.now?.()));
  }, [values, setErrors, o, snoozeCleared, run]);

  const snoozed =
    !snoozeCleared && (o.record?.snoozeUntilDate !== undefined || o.record?.snoozeUntilOdometer !== undefined);

  return {
    values,
    setField,
    selectItem,
    itemOptions,
    snoozed,
    clearSnooze: () => setSnoozeCleared(true),
    errors: form.errors,
    dirty: form.dirty || snoozeCleared,
    saving,
    isEdit: o.record !== undefined,
    submit,
  };
}
