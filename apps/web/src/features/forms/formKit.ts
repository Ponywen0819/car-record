import { useCallback, useMemo, useRef, useState } from 'react';
import { checkOdometer, type OdometerCheck, type OdometerReading } from '../../domain';
import { formatKm, isBlank, parseDecimal } from '../../lib/format';

export type SubmitResult<T> =
  | { ok: true; record: T }
  | { ok: false; reason: 'invalid' | 'warning' }
  | { ok: false; reason: 'error'; message: string };

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type Errors<V> = Partial<Record<keyof V | (string & {}), string>>;

/** Shared context every entry form needs. */
export interface EntryFormContext {
  db: import('../../db/db').CarDB;
  vehicle: import('@car-record/shared').Vehicle;
  readings: OdometerReading[];
  /** Estimated current odometer (prefill), null when unknown. */
  estimate: number | null;
  today: string;
  now?: () => number;
}

export interface NumberRule {
  /** Message when blank; omit for optional fields. */
  required?: string;
  integer?: boolean;
  /** Message when the value is not > 0. */
  positive?: string;
  min?: number;
  max?: number;
  /** Message for malformed / out-of-range input (default 格式不正確). */
  invalid?: string;
}

/** Parse a numeric field, recording an error into `errors[key]` when invalid. */
export function readNumber(
  raw: string,
  key: string,
  errors: Record<string, string>,
  rule: NumberRule = {},
): number | undefined {
  const invalid = rule.invalid ?? '格式不正確';
  if (isBlank(raw)) {
    if (rule.required) errors[key] = rule.required;
    return undefined;
  }
  const n = parseDecimal(raw);
  if (n === undefined || Number.isNaN(n)) {
    errors[key] = invalid;
    return undefined;
  }
  if (rule.integer && !Number.isInteger(n)) {
    errors[key] = invalid;
    return undefined;
  }
  if (rule.positive && n <= 0) {
    errors[key] = rule.positive;
    return undefined;
  }
  if ((rule.min !== undefined && n < rule.min) || (rule.max !== undefined && n > rule.max)) {
    errors[key] = invalid;
    return undefined;
  }
  return n;
}

export function trimOrUndefined(s: string): string | undefined {
  const t = s.trim();
  return t ? t : undefined;
}

/** Strip the fields the repository manages. */
export function toDraft<T extends { updatedAt?: number; rev?: number }>(record: T): Omit<T, 'updatedAt' | 'rev'> {
  const { updatedAt: _u, rev: _r, ...rest } = record;
  return rest;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function odometerWarningText(check: OdometerCheck): string | null {
  if (check.ok) return null;
  if (check.reason === 'lower_than_previous') {
    return `里程比 ${check.previous.date} 的紀錄（${formatKm(check.previous.odometer)}）還低，確定沒打錯？再按一次儲存。`;
  }
  return `里程比之後 ${check.next.date} 的紀錄（${formatKm(check.next.odometer)}）還高，確定沒打錯？再按一次儲存。`;
}

/**
 * Odometer sanity check (SPEC §1.4): the first save attempt with a suspicious value shows a
 * warning; tapping save again with the same value saves anyway.
 */
export function useOdometerGuard(readings: OdometerReading[], excludeRecordId?: string) {
  const [warning, setWarning] = useState<string | null>(null);
  const armed = useRef<string | null>(null);

  const allow = useCallback(
    (odometer: number, date: string): boolean => {
      const key = `${odometer}|${date}`;
      const result = checkOdometer(odometer, date, readings, excludeRecordId);
      if (result.ok) {
        setWarning(null);
        return true;
      }
      if (armed.current === key) return true;
      armed.current = key;
      setWarning(odometerWarningText(result));
      return false;
    },
    [readings, excludeRecordId],
  );

  const reset = useCallback(() => {
    armed.current = null;
    setWarning(null);
  }, []);

  return { warning, allow, reset };
}

/** Values + dirty tracking + per-field error clearing. */
export function useFormState<V extends object>(init: () => V) {
  const [initial] = useState(init);
  const [values, setValues] = useState<V>(initial);
  const [errors, setErrors] = useState<Errors<V>>({});
  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initial), [values, initial]);

  const setField = useCallback(<K extends keyof V>(key: K, value: V[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  return { initial, values, setValues, errors, setErrors, dirty, setField };
}

/** Run a save while tracking `saving`, mapping thrown errors to a result. */
export function useSaving() {
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<SubmitResult<T>> => {
    if (busy.current) return { ok: false, reason: 'invalid' };
    busy.current = true;
    setSaving(true);
    try {
      return { ok: true, record: await fn() };
    } catch (e) {
      return { ok: false, reason: 'error', message: errorMessage(e) };
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, []);
  return { saving, run };
}
