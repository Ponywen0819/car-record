import type { FormProps } from '../../app/formRequest';
import { useServices } from '../../app/services';
import { useVehicleContext } from '../../app/vehicleContext';
import { FieldShell, NumberInput, TextInput } from '../../components/NumberInput';
import { FormLayout, SwitchRow } from '../../components/FormLayout';
import { useFormChrome } from '../forms/useFormChrome';
import { deleteWithUndo } from '../dashboard/undoableActions';
import { useReminderRuleForm } from './useReminderRuleForm';

export function ReminderRuleForm(props: FormProps<Extract<FormProps['request'], { kind: 'reminderRule' }>>) {
  const { db } = useServices();
  const { vehicle, data } = useVehicleContext();
  const record = props.request.record;
  const form = useReminderRuleForm({
    db,
    vehicle,
    record,
    existingKeys: data.reminderRules.map((r) => r.itemKey),
  });
  const chrome = useFormChrome(props, form, form.isEdit ? '已更新提醒規則' : '已新增提醒規則');
  const { values, setField, errors } = form;

  return (
    <FormLayout
      title={form.isEdit ? '編輯提醒' : '新增提醒'}
      chrome={props.chrome}
      backHref="/settings"
      onCancel={props.onCancel}
      onSave={() => void chrome.save()}
      saving={form.saving}
      error={chrome.saveError}
    >
      <FieldShell label="保養項目">
        {(id) => (
          <select id={id} className="input" value={values.itemKey} onChange={(e) => form.selectItem(e.target.value)}>
            {form.itemOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </FieldShell>
      <TextInput label="顯示名稱" value={values.label} onChange={(v) => setField('label', v)} error={errors.label} enterKeyHint="next" />
      <div className="field-row">
        <NumberInput label="每隔里程" suffix="km" inputMode="numeric" value={values.everyKm} onChange={(v) => setField('everyKm', v)} error={errors.everyKm} enterKeyHint="next" />
        <NumberInput label="每隔時間" suffix="個月" inputMode="numeric" value={values.everyMonths} onChange={(v) => setField('everyMonths', v)} error={errors.everyMonths} enterKeyHint="done" />
      </div>
      <div className="field-hint">里程或時間哪個先到就先提醒；只填一個也可以。</div>
      <SwitchRow label="啟用提醒" checked={values.enabled} onChange={(v) => setField('enabled', v)} />
      {form.snoozed ? (
        <div className="hint-box">
          已延後提醒
          {record?.snoozeUntilOdometer !== undefined ? `至 ${record.snoozeUntilOdometer.toLocaleString()} km` : ''}
          {record?.snoozeUntilDate ? ` / ${record.snoozeUntilDate}` : ''}
          <button type="button" className="plain-button" style={{ marginLeft: 8, minHeight: 32 }} onClick={form.clearSnooze}>
            取消延後
          </button>
        </div>
      ) : null}
      {record ? (
        <button
          type="button"
          className="danger-link"
          onClick={() => void deleteWithUndo(db, 'reminderRules', record.id, `「${record.label}」提醒`).then(props.onUndoable)}
        >
          刪除此提醒規則
        </button>
      ) : null}
    </FormLayout>
  );
}
