import { EXPENSE_CATEGORIES } from '@car-record/shared';
import type { FormProps } from '../../app/formRequest';
import { useServices } from '../../app/services';
import { useVehicleContext } from '../../app/vehicleContext';
import { ChipSelect } from '../../components/ChipSelect';
import { FormLayout, MoreFieldsButton, SwitchRow } from '../../components/FormLayout';
import { NumberInput, TextArea, TextInput } from '../../components/NumberInput';
import { PhotoField } from '../../components/PhotoField';
import { useFormChrome } from '../forms/useFormChrome';
import { dateHint } from '../fuel/FuelForm';
import { useExpenseForm } from './useExpenseForm';

export function ExpenseForm(props: FormProps<Extract<FormProps['request'], { kind: 'expense' }>>) {
  const { db } = useServices();
  const { vehicle, data, state, today } = useVehicleContext();
  const form = useExpenseForm({
    db,
    vehicle,
    readings: state.readings,
    estimate: state.estimate?.value ?? null,
    today,
    expenseRecords: data.expenses,
    record: props.request.record,
    duplicateOf: props.request.duplicateOf,
  });
  const chrome = useFormChrome(props, form, form.isEdit ? '已更新費用' : '已儲存費用');
  const { values, setField, errors } = form;

  return (
    <FormLayout
      title={form.isEdit ? '編輯費用' : '記費用'}
      chrome={props.chrome}
      onCancel={props.onCancel}
      onSave={() => void chrome.save()}
      saving={form.saving}
      warning={form.warning}
      error={chrome.saveError}
    >
      <div className="field">
        <span className="field-label">分類</span>
        <ChipSelect
          options={EXPENSE_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
          selected={[values.category]}
          onToggle={(c) => setField('category', c)}
        />
      </div>
      <div className="field-row">
        <NumberInput
          label="金額"
          suffix="元"
          inputMode="numeric"
          value={values.cost}
          onChange={(v) => setField('cost', v)}
          enterKeyHint="done"
          error={errors.cost}
        />
        <TextInput label="日期" type="date" value={values.date} onChange={(v) => setField('date', v)} error={errors.date} hint={dateHint(values.date, today)} />
      </div>
      <SwitchRow label="週期性支出" hint="例如保險每 12 個月" checked={values.recurring} onChange={(v) => setField('recurring', v)} />
      {values.recurring ? (
        <NumberInput
          label="每幾個月"
          suffix="個月"
          inputMode="numeric"
          value={values.everyMonths}
          onChange={(v) => setField('everyMonths', v)}
          enterKeyHint="done"
          error={errors.everyMonths}
        />
      ) : null}
      {chrome.advanced ? (
        <>
          <NumberInput
            label="里程（選填）"
            suffix="km"
            inputMode="numeric"
            value={values.odometer}
            placeholder={form.odometerPlaceholder}
            onChange={(v) => setField('odometer', v)}
            enterKeyHint="done"
            error={errors.odometer}
          />
          <TextArea label="備註" value={values.note} onChange={(v) => setField('note', v)} />
          <PhotoField db={db} photoIds={values.photoIds} onChange={(ids) => setField('photoIds', ids)} />
        </>
      ) : (
        <MoreFieldsButton label="里程、備註、照片" onClick={chrome.expand} />
      )}
    </FormLayout>
  );
}
