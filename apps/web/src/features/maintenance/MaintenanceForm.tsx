import { useMemo } from 'react';
import { MAINTENANCE_KINDS, MAINTENANCE_KIND_LABELS, maintenanceItemLabel } from '@car-record/shared';
import type { FormProps } from '../../app/formRequest';
import { useServices } from '../../app/services';
import { useVehicleContext } from '../../app/vehicleContext';
import { ChipSelect } from '../../components/ChipSelect';
import { FormLayout, MoreFieldsButton } from '../../components/FormLayout';
import { NumberInput, TextArea, TextInput } from '../../components/NumberInput';
import { formatKm, formatNumber } from '../../lib/format';
import { ReceiptScanButton } from '../forms/ReceiptScanButton';
import { scanReceipt } from '../forms/receiptScan';
import { useFormChrome } from '../forms/useFormChrome';
import { dateHint } from '../fuel/FuelForm';
import { useMaintenanceForm } from './useMaintenanceForm';

export function MaintenanceForm(props: FormProps<Extract<FormProps['request'], { kind: 'maintenance' }>>) {
  const { db } = useServices();
  const { vehicle, data, state, today } = useVehicleContext();
  const form = useMaintenanceForm({
    db,
    vehicle,
    readings: state.readings,
    estimate: state.estimate?.value ?? null,
    today,
    maintenanceRecords: data.maintenance,
    reminderStatuses: state.reminders,
    record: props.request.record,
    duplicateOf: props.request.duplicateOf,
    preselect: props.request.preselect,
  });
  const chrome = useFormChrome(props, form, form.isEdit ? '已更新保養紀錄' : '已儲存保養紀錄');
  const { values, setField, errors } = form;

  const onScan = async (file: File) => {
    const res = await scanReceipt(file);
    if (!res.ok) return { ok: false as const, message: res.message };
    const applied = form.applyInvoice(res.fill);
    if (!applied.ok) {
      return { ok: false as const, message: `這張發票已在 ${applied.duplicateOf.date} 記錄過` };
    }
    return {
      ok: true as const,
      message: `已從發票 ${res.fill.invoiceNumber} 填入日期、金額，品項寫在備註，請選擇保養項目`,
    };
  };

  const shops = useMemo(
    () => Array.from(new Set(data.maintenance.map((m) => m.shop).filter((s): s is string => !!s))).slice(0, 20),
    [data.maintenance],
  );
  const last = state.estimate?.last;

  return (
    <FormLayout
      title={form.isEdit ? '編輯保養' : '記保養'}
      chrome={props.chrome}
      onCancel={props.onCancel}
      onSave={() => void chrome.save()}
      saving={form.saving}
      warning={form.warning}
      error={chrome.saveError}
    >
      <ReceiptScanButton onScan={onScan} />
      <div className="field-row">
        <TextInput label="日期" type="date" value={values.date} onChange={(v) => setField('date', v)} error={errors.date} hint={dateHint(values.date, today)} />
        <NumberInput
          label="里程"
          suffix="km"
          inputMode="numeric"
          value={values.odometer}
          onChange={(v) => setField('odometer', v)}
          selectOnFocus
          enterKeyHint="next"
          error={errors.odometer}
          hint={last ? `上次 ${formatKm(last.odometer)}` : undefined}
        />
      </div>
      <div className="field">
        <span className="field-label">類型</span>
        <ChipSelect
          options={MAINTENANCE_KINDS.map((k) => ({ value: k, label: MAINTENANCE_KIND_LABELS[k] }))}
          selected={[values.kind]}
          onToggle={(k) => setField('kind', k)}
        />
      </div>
      <div className={`field${errors.items ? ' has-error' : ''}`}>
        <span className="field-label">項目{form.dueKeys.length > 0 ? '（● 即將到期，已預先勾選）' : ''}</span>
        <ChipSelect
          ariaLabel="保養項目"
          options={form.itemOptions}
          selected={values.items}
          hinted={form.dueKeys}
          onToggle={form.toggleItem}
        />
        {errors.items ? (
          <div className="field-error" role="alert">
            {errors.items}
          </div>
        ) : null}
      </div>
      <NumberInput
        label="費用（總額）"
        suffix="元"
        inputMode="numeric"
        value={values.cost}
        onChange={(v) => setField('cost', v)}
        placeholder={form.itemsTotal !== null ? formatNumber(form.itemsTotal) : undefined}
        hint={form.itemsTotal !== null && !values.cost ? `留空則用逐項合計 ${formatNumber(form.itemsTotal)} 元` : undefined}
        enterKeyHint="next"
        error={errors.cost}
      />
      <TextInput label="保養廠" value={values.shop} onChange={(v) => setField('shop', v)} list="shop-options" enterKeyHint="done" />
      <datalist id="shop-options">
        {shops.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {chrome.advanced ? (
        <>
          {values.items.length > 0 ? (
            <div className="field">
              <span className="field-label">逐項費用（選填）</span>
              {values.items.map((k, i) => (
                <NumberInput
                  key={k}
                  label={maintenanceItemLabel(k)}
                  suffix="元"
                  inputMode="numeric"
                  value={values.itemCosts[k] ?? ''}
                  onChange={(v) => form.setItemCost(k, v)}
                  enterKeyHint={i === values.items.length - 1 ? 'done' : 'next'}
                  error={errors[`itemCost.${k}`]}
                />
              ))}
            </div>
          ) : null}
          <TextArea label="備註" value={values.note} onChange={(v) => setField('note', v)} />
        </>
      ) : (
        <MoreFieldsButton label="逐項費用、備註" onClick={chrome.expand} />
      )}
    </FormLayout>
  );
}
