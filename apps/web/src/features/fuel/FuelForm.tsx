import { useMemo } from 'react';
import type { FormProps } from '../../app/formRequest';
import { useServices } from '../../app/services';
import { useVehicleContext } from '../../app/vehicleContext';
import { ChipSelect } from '../../components/ChipSelect';
import { FormLayout, MoreFieldsButton, SwitchRow } from '../../components/FormLayout';
import { NumberInput, TextArea, TextInput } from '../../components/NumberInput';
import { PhotoField } from '../../components/PhotoField';
import { formatKm } from '../../lib/format';
import { useFormChrome } from '../forms/useFormChrome';
import { useFuelForm } from './useFuelForm';

const GRADES = ['92', '95', '98', '柴油'];

export function dateHint(date: string, today: string): string | undefined {
  if (date === today) return '今天';
  return undefined;
}

export function FuelForm(props: FormProps<Extract<FormProps['request'], { kind: 'fuel' }>>) {
  const { db } = useServices();
  const { vehicle, data, state, today } = useVehicleContext();
  const form = useFuelForm({
    db,
    vehicle,
    readings: state.readings,
    estimate: state.estimate?.value ?? null,
    today,
    fuelRecords: data.fuel,
    record: props.request.record,
    duplicateOf: props.request.duplicateOf,
  });
  const chrome = useFormChrome(props, form, form.isEdit ? '已更新加油紀錄' : '已儲存加油紀錄');
  const ev = vehicle.fuelType === 'ev';
  const { values, setField, errors } = form;

  const stations = useMemo(
    () => Array.from(new Set(data.fuel.map((f) => f.station).filter((s): s is string => !!s))).slice(0, 20),
    [data.fuel],
  );
  const last = state.estimate?.last;
  const odoHint = last ? `上次 ${formatKm(last.odometer)}（${last.date}）` : undefined;
  const derivedHint = (f: 'amount' | 'unitPrice' | 'total') => (form.derived === f ? '自動計算' : undefined);

  return (
    <FormLayout
      title={form.isEdit ? (ev ? '編輯充電' : '編輯加油') : ev ? '記充電' : '記加油'}
      chrome={props.chrome}
      onCancel={props.onCancel}
      onSave={() => void chrome.save()}
      saving={form.saving}
      warning={form.warning}
      error={chrome.saveError}
    >
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
          hint={odoHint}
        />
      </div>
      <div className="field-row">
        <NumberInput
          label={ev ? '電量' : '油量'}
          suffix={form.unit}
          value={values.amount}
          onChange={(v) => setField('amount', v)}
          enterKeyHint="next"
          error={errors.amount}
          hint={derivedHint('amount')}
        />
        <NumberInput
          label="總價"
          suffix="元"
          inputMode="numeric"
          value={values.total}
          onChange={(v) => setField('total', v)}
          enterKeyHint="next"
          error={errors.total}
          hint={derivedHint('total')}
        />
      </div>
      <NumberInput
        label={`單價（元/${form.unit}）`}
        value={values.unitPrice}
        onChange={(v) => setField('unitPrice', v)}
        enterKeyHint="done"
        error={errors.unitPrice}
        hint={derivedHint('unitPrice') ?? '總價、油量、單價填任兩個即可'}
      />
      <SwitchRow
        label={ev ? '充飽' : '加滿'}
        hint="計算油耗需要加滿的紀錄"
        checked={values.isFull}
        onChange={(v) => setField('isFull', v)}
      />
      <TextInput
        label={ev ? '充電站' : '加油站'}
        value={values.station}
        onChange={(v) => setField('station', v)}
        list="station-options"
        enterKeyHint="done"
      />
      <datalist id="station-options">
        {stations.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {!ev ? (
        <div className="field">
          <span className="field-label">油品</span>
          <ChipSelect
            options={GRADES.map((g) => ({ value: g, label: g }))}
            selected={values.grade ? [values.grade] : []}
            onToggle={(g) => setField('grade', values.grade === g ? '' : g)}
          />
        </div>
      ) : null}
      {chrome.advanced ? (
        <>
          <TextArea label="備註" value={values.note} onChange={(v) => setField('note', v)} />
          <PhotoField db={db} photoIds={values.photoIds} onChange={(ids) => setField('photoIds', ids)} />
        </>
      ) : (
        <MoreFieldsButton label="備註、照片" onClick={chrome.expand} />
      )}
    </FormLayout>
  );
}
