import { useCallback } from 'react';
import type { FuelType, Vehicle } from '@car-record/shared';
import { defaultReminderRules } from '../../domain';
import { saveRecord, type Draft } from '../../db/repository';
import type { CarDB } from '../../db/db';
import { compact, formatInputNumber, isBlank } from '../../lib/format';
import {
  DATE_RE,
  readNumber,
  toDraft,
  trimOrUndefined,
  useFormState,
  useSaving,
  type SubmitResult,
} from '../forms/formKit';

export interface VehicleFormValues {
  name: string;
  plate: string;
  brand: string;
  model: string;
  year: string;
  fuelType: FuelType;
  vin: string;
  purchaseDate: string;
  purchaseOdometer: string;
  purchasePrice: string;
}

export interface UseVehicleFormOptions {
  db: CarDB;
  record?: Vehicle;
  now?: () => number;
}

function initialValues(r?: Vehicle): VehicleFormValues {
  return {
    name: r?.name ?? '',
    plate: r?.plate ?? '',
    brand: r?.brand ?? '',
    model: r?.model ?? '',
    year: formatInputNumber(r?.year),
    fuelType: r?.fuelType ?? 'gasoline',
    vin: r?.vin ?? '',
    purchaseDate: r?.purchaseDate ?? '',
    purchaseOdometer: formatInputNumber(r?.purchaseOdometer),
    purchasePrice: formatInputNumber(r?.purchasePrice),
  };
}

/** Vehicle create/edit. Creating also creates the default reminder rules (SPEC §2.5). */
export function useVehicleForm(o: UseVehicleFormOptions) {
  const form = useFormState(() => initialValues(o.record));
  const { values, setErrors } = form;
  const { saving, run } = useSaving();

  const submit = useCallback(async (): Promise<SubmitResult<Vehicle>> => {
    const errors: Record<string, string> = {};
    if (isBlank(values.name)) errors.name = '請輸入名稱或車牌';
    const year = readNumber(values.year, 'year', errors, { integer: true, min: 1900, max: 2100, invalid: '年份格式不正確' });
    const purchaseOdometer = readNumber(values.purchaseOdometer, 'purchaseOdometer', errors);
    const purchasePrice = readNumber(values.purchasePrice, 'purchasePrice', errors);
    if (!isBlank(values.purchaseDate) && !DATE_RE.test(values.purchaseDate)) errors.purchaseDate = '日期格式不正確';
    setErrors(errors);
    if (Object.keys(errors).length > 0) return { ok: false, reason: 'invalid' };

    const draft = compact({
      id: o.record?.id,
      createdAt: o.record?.createdAt,
      name: values.name.trim(),
      plate: trimOrUndefined(values.plate),
      brand: trimOrUndefined(values.brand),
      model: trimOrUndefined(values.model),
      year,
      fuelType: values.fuelType,
      vin: trimOrUndefined(values.vin),
      purchaseDate: trimOrUndefined(values.purchaseDate),
      purchaseOdometer,
      purchasePrice,
    });
    const isNew = o.record === undefined;
    return run(async () => {
      const now = o.now?.() ?? Date.now();
      const saved = await saveRecord(o.db, 'vehicles', draft as Draft<'vehicles'>, now);
      if (isNew) {
        for (const rule of defaultReminderRules(saved, now)) {
          await saveRecord(o.db, 'reminderRules', toDraft(rule) as Draft<'reminderRules'>, now);
        }
      }
      return saved;
    });
  }, [values, setErrors, o, run]);

  return {
    values,
    setField: form.setField,
    errors: form.errors,
    dirty: form.dirty,
    saving,
    isEdit: o.record !== undefined,
    submit,
  };
}
