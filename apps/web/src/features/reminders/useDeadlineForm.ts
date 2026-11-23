import { useCallback, useState } from 'react';
import { DEADLINE_KINDS, type Deadline, type DeadlineKind, type Vehicle } from '@car-record/shared';
import { saveRecord, type Draft } from '../../db/repository';
import type { CarDB } from '../../db/db';
import { compact, formatInputNumber, isBlank } from '../../lib/format';
import { DATE_RE, readNumber, trimOrUndefined, useFormState, useSaving, type SubmitResult } from '../forms/formKit';

export interface DeadlineFormValues {
  kind: DeadlineKind;
  label: string;
  dueDate: string;
  remindDaysBefore: string;
  repeatEveryMonths: string;
  note: string;
}

export interface UseDeadlineFormOptions {
  db: CarDB;
  vehicle: Vehicle;
  record?: Deadline;
  now?: () => number;
}

export const deadlineKindLabel = (kind: DeadlineKind): string =>
  DEADLINE_KINDS.find((k) => k.key === kind)?.label ?? kind;

function initialValues(r?: Deadline): DeadlineFormValues {
  if (r) {
    return {
      kind: r.kind,
      label: r.label,
      dueDate: r.dueDate,
      remindDaysBefore: formatInputNumber(r.remindDaysBefore),
      repeatEveryMonths: formatInputNumber(r.repeatEveryMonths),
      note: r.note ?? '',
    };
  }
  return { kind: 'insurance', label: deadlineKindLabel('insurance'), dueDate: '', remindDaysBefore: '30', repeatEveryMonths: '12', note: '' };
}

export function useDeadlineForm(o: UseDeadlineFormOptions) {
  const form = useFormState(() => initialValues(o.record));
  const { values, setValues, setErrors } = form;
  const [labelEdited, setLabelEdited] = useState(o.record !== undefined);
  const { saving, run } = useSaving();

  const setField = useCallback(
    <K extends keyof DeadlineFormValues>(key: K, value: DeadlineFormValues[K]) => {
      if (key === 'label') setLabelEdited(true);
      form.setField(key, value);
    },
    [form],
  );

  const selectKind = useCallback(
    (kind: DeadlineKind) => {
      setValues((prev) => ({ ...prev, kind, ...(labelEdited ? {} : { label: deadlineKindLabel(kind) }) }));
    },
    [setValues, labelEdited],
  );

  const submit = useCallback(async (): Promise<SubmitResult<Deadline>> => {
    const errors: Record<string, string> = {};
    if (isBlank(values.label)) errors.label = '請輸入名稱';
    if (!DATE_RE.test(values.dueDate)) errors.dueDate = '請選擇到期日';
    const remindDaysBefore = readNumber(values.remindDaysBefore, 'remindDaysBefore', errors, {
      required: '請輸入天數',
      integer: true,
      invalid: '請輸入整數天數',
    });
    const repeatEveryMonths = readNumber(values.repeatEveryMonths, 'repeatEveryMonths', errors, {
      integer: true,
      positive: '請輸入整數月數',
      invalid: '請輸入整數月數',
    });
    setErrors(errors);
    if (Object.keys(errors).length > 0 || remindDaysBefore === undefined) return { ok: false, reason: 'invalid' };

    const draft = compact({
      id: o.record?.id,
      createdAt: o.record?.createdAt,
      vehicleId: o.vehicle.id,
      kind: values.kind,
      label: values.label.trim(),
      dueDate: values.dueDate,
      remindDaysBefore,
      repeatEveryMonths,
      note: trimOrUndefined(values.note),
    });
    return run(() => saveRecord(o.db, 'deadlines', draft as Draft<'deadlines'>, o.now?.()));
  }, [values, setErrors, o, run]);

  return {
    values,
    setField,
    selectKind,
    errors: form.errors,
    dirty: form.dirty,
    saving,
    isEdit: o.record !== undefined,
    submit,
  };
}
