import { useCallback } from 'react';
import type { Vehicle } from '@car-record/shared';
import type { FormChrome, FormRequest } from './formRequest';
import { useNotify } from './useNotify';
import { useVehicleSelection } from './vehicleContext';
import { FuelForm } from '../features/fuel/FuelForm';
import { MaintenanceForm } from '../features/maintenance/MaintenanceForm';
import { ExpenseForm } from '../features/expense/ExpenseForm';
import { VehicleForm } from '../features/vehicle/VehicleForm';
import { ReminderRuleForm } from '../features/reminders/ReminderRuleForm';
import { DeadlineForm } from '../features/reminders/DeadlineForm';
import type { Undoable } from '../features/dashboard/undoableActions';

export interface FormHostProps {
  request: FormRequest;
  chrome: FormChrome;
  expanded: boolean;
  onExpand: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** Close the container; `saved` skips the discard confirmation. */
  onClose: (saved: boolean) => void;
}

/** Renders the right form for a request, in a sheet or on a page. */
export function FormHost(props: FormHostProps) {
  const { request, onClose } = props;
  const notify = useNotify();
  const { setCurrentId } = useVehicleSelection();

  const onSaved = useCallback(
    (message: string, record?: unknown) => {
      if (request.kind === 'vehicle' && !request.record && record) setCurrentId((record as Vehicle).id);
      onClose(true);
      notify.toast(`✓ ${message}`, 'success');
    },
    [request, onClose, notify, setCurrentId],
  );
  const onUndoable = useCallback(
    (u: Undoable) => {
      onClose(true);
      notify.undoToast(u);
    },
    [onClose, notify],
  );
  const onCancel = useCallback(() => onClose(false), [onClose]);

  const common = {
    chrome: props.chrome,
    expanded: props.expanded,
    onExpand: props.onExpand,
    onDirtyChange: props.onDirtyChange,
    onCancel,
    onSaved,
    onUndoable,
  };

  switch (request.kind) {
    case 'fuel':
      return <FuelForm {...common} request={request} />;
    case 'maintenance':
      return <MaintenanceForm {...common} request={request} />;
    case 'expense':
      return <ExpenseForm {...common} request={request} />;
    case 'vehicle':
      return <VehicleForm {...common} record={request.record} />;
    case 'reminderRule':
      return <ReminderRuleForm {...common} request={request} />;
    case 'deadline':
      return <DeadlineForm {...common} request={request} />;
  }
}
