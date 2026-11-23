import type { ReactNode } from 'react';
import { FUEL_TYPES, FUEL_TYPE_LABELS, type Vehicle } from '@car-record/shared';
import type { FormChrome } from '../../app/formRequest';
import { useServices } from '../../app/services';
import { ChipSelect } from '../../components/ChipSelect';
import { FormLayout, MoreFieldsButton } from '../../components/FormLayout';
import { NumberInput, TextInput } from '../../components/NumberInput';
import { useFormChrome } from '../forms/useFormChrome';
import { useVehicleForm } from './useVehicleForm';

export interface VehicleFormProps {
  record?: Vehicle;
  chrome: FormChrome;
  expanded: boolean;
  onExpand: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onSaved: (message: string, record?: unknown) => void;
  title?: string;
  intro?: ReactNode;
}

export function VehicleForm(props: VehicleFormProps) {
  const { db } = useServices();
  const form = useVehicleForm({ db, record: props.record });
  const chrome = useFormChrome(props, form, form.isEdit ? '已更新車輛資料' : '已新增車輛');
  const { values, setField, errors } = form;

  return (
    <FormLayout
      title={props.title ?? (form.isEdit ? '編輯車輛' : '新增車輛')}
      chrome={props.chrome}
      backHref="/settings"
      onCancel={props.onCancel}
      onSave={() => void chrome.save()}
      saving={form.saving}
      error={chrome.saveError}
      saveLabel={form.isEdit ? '儲存' : '開始使用'}
    >
      {props.intro}
      <TextInput label="名稱／車牌" value={values.name} onChange={(v) => setField('name', v)} error={errors.name} placeholder="例如：小白、ABC-1234" enterKeyHint="next" />
      <div className="field">
        <span className="field-label">燃料類型</span>
        <ChipSelect
          options={FUEL_TYPES.map((f) => ({ value: f, label: FUEL_TYPE_LABELS[f] }))}
          selected={[values.fuelType]}
          onToggle={(f) => setField('fuelType', f)}
        />
      </div>
      <div className="field-row">
        <TextInput label="品牌" value={values.brand} onChange={(v) => setField('brand', v)} enterKeyHint="next" />
        <TextInput label="車型" value={values.model} onChange={(v) => setField('model', v)} enterKeyHint="next" />
      </div>
      <div className="field-row">
        <TextInput label="車牌" value={values.plate} onChange={(v) => setField('plate', v)} autoCapitalize="characters" enterKeyHint="next" />
        <NumberInput label="年份" inputMode="numeric" value={values.year} onChange={(v) => setField('year', v)} error={errors.year} enterKeyHint="done" />
      </div>
      {chrome.advanced ? (
        <>
          <TextInput label="購車日期" type="date" value={values.purchaseDate} onChange={(v) => setField('purchaseDate', v)} error={errors.purchaseDate} />
          <div className="field-row">
            <NumberInput label="購車里程" suffix="km" inputMode="numeric" value={values.purchaseOdometer} onChange={(v) => setField('purchaseOdometer', v)} error={errors.purchaseOdometer} enterKeyHint="next" />
            <NumberInput label="購車價格" suffix="元" inputMode="numeric" value={values.purchasePrice} onChange={(v) => setField('purchasePrice', v)} error={errors.purchasePrice} enterKeyHint="next" />
          </div>
          <TextInput label="VIN／引擎號碼" value={values.vin} onChange={(v) => setField('vin', v)} autoCapitalize="characters" enterKeyHint="done" />
        </>
      ) : (
        <MoreFieldsButton label="購車資料、VIN" onClick={chrome.expand} />
      )}
    </FormLayout>
  );
}
