import { DEADLINE_KINDS } from '@car-record/shared';
import type { FormProps } from '../../app/formRequest';
import { useServices } from '../../app/services';
import { useVehicleContext } from '../../app/vehicleContext';
import { ChipSelect } from '../../components/ChipSelect';
import { FormLayout } from '../../components/FormLayout';
import { NumberInput, TextArea, TextInput } from '../../components/NumberInput';
import { useFormChrome } from '../forms/useFormChrome';
import { deleteWithUndo } from '../dashboard/undoableActions';
import { useDeadlineForm } from './useDeadlineForm';

export function DeadlineForm(props: FormProps<Extract<FormProps['request'], { kind: 'deadline' }>>) {
  const { db } = useServices();
  const { vehicle } = useVehicleContext();
  const record = props.request.record;
  const form = useDeadlineForm({ db, vehicle, record });
  const chrome = useFormChrome(props, form, form.isEdit ? '已更新到期提醒' : '已新增到期提醒');
  const { values, setField, errors } = form;

  return (
    <FormLayout
      title={form.isEdit ? '編輯到期提醒' : '新增到期提醒'}
      chrome={props.chrome}
      backHref="/settings"
      onCancel={props.onCancel}
      onSave={() => void chrome.save()}
      saving={form.saving}
      error={chrome.saveError}
    >
      <div className="field">
        <span className="field-label">類型</span>
        <ChipSelect
          options={DEADLINE_KINDS.map((k) => ({ value: k.key, label: k.label }))}
          selected={[values.kind]}
          onToggle={form.selectKind}
        />
      </div>
      <TextInput label="名稱" value={values.label} onChange={(v) => setField('label', v)} error={errors.label} enterKeyHint="next" />
      <TextInput label="到期日" type="date" value={values.dueDate} onChange={(v) => setField('dueDate', v)} error={errors.dueDate} />
      <div className="field-row">
        <NumberInput label="提前提醒" suffix="天" inputMode="numeric" value={values.remindDaysBefore} onChange={(v) => setField('remindDaysBefore', v)} error={errors.remindDaysBefore} enterKeyHint="next" />
        <NumberInput label="每隔（選填）" suffix="個月" inputMode="numeric" value={values.repeatEveryMonths} onChange={(v) => setField('repeatEveryMonths', v)} error={errors.repeatEveryMonths} enterKeyHint="done" hint="完成後自動排下一次" />
      </div>
      <TextArea label="備註" value={values.note} onChange={(v) => setField('note', v)} />
      {record ? (
        <button
          type="button"
          className="danger-link"
          onClick={() => void deleteWithUndo(db, 'deadlines', record.id, `「${record.label}」`).then(props.onUndoable)}
        >
          刪除此到期提醒
        </button>
      ) : null}
    </FormLayout>
  );
}
