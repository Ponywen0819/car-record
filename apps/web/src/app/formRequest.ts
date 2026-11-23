import type {
  Deadline,
  ExpenseRecord,
  FuelRecord,
  MaintenanceRecord,
  ReminderRule,
  Vehicle,
} from '@car-record/shared';

/** What the bottom-sheet form (or the edit page) should show. */
export type FormRequest =
  | { kind: 'fuel'; record?: FuelRecord; duplicateOf?: FuelRecord }
  | { kind: 'maintenance'; record?: MaintenanceRecord; duplicateOf?: MaintenanceRecord; preselect?: string[] }
  | { kind: 'expense'; record?: ExpenseRecord; duplicateOf?: ExpenseRecord }
  | { kind: 'vehicle'; record?: Vehicle }
  | { kind: 'reminderRule'; record?: ReminderRule }
  | { kind: 'deadline'; record?: Deadline };

export type FormChrome = 'sheet' | 'page' | 'standalone';

export interface FormProps<R extends FormRequest = FormRequest> {
  request: R;
  chrome: FormChrome;
  /** Sheet expanded to full height → show advanced fields. */
  expanded: boolean;
  /** Expand the sheet (non-gesture alternative to dragging up). */
  onExpand: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  /** Saved successfully: close + show a short toast. */
  onSaved: (message: string, record?: unknown) => void;
  /** Deleted from inside the form: close + show an undo toast. */
  onUndoable: (u: { message: string; undo: () => Promise<void> }) => void;
}
