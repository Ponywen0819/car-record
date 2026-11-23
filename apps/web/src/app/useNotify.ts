import { useCallback } from 'react';
import { useIonToast } from '@ionic/react';
import type { Undoable } from '../features/dashboard/undoableActions';
import { errorMessage } from '../features/forms/formKit';

export const TAB_BAR_ID = 'main-tab-bar';

/** Lightweight toasts (SPEC §5.5) and undo toasts (SPEC §5.2: undo instead of confirm). */
export function useNotify() {
  const [present] = useIonToast();

  const toast = useCallback(
    (message: string, color?: 'danger' | 'success' | 'warning') => {
      void present({
        message,
        duration: color === 'danger' ? 4000 : 1500,
        position: 'top',
        color,
        cssClass: 'app-toast',
      });
    },
    [present],
  );

  const undoToast = useCallback(
    (u: Undoable) => {
      void present({
        message: u.message,
        duration: 5000,
        position: 'bottom',
        positionAnchor: document.getElementById(TAB_BAR_ID) ? TAB_BAR_ID : undefined,
        buttons: [
          {
            text: '復原',
            handler: () => {
              u.undo().catch((e) => toast(`復原失敗：${errorMessage(e)}`, 'danger'));
            },
          },
        ],
      });
    },
    [present, toast],
  );

  /** Run an undoable action and show its toast; errors become an error toast. */
  const runUndoable = useCallback(
    async (action: () => Promise<Undoable>) => {
      try {
        undoToast(await action());
      } catch (e) {
        toast(`失敗：${errorMessage(e)}`, 'danger');
      }
    },
    [undoToast, toast],
  );

  return { toast, undoToast, runUndoable };
}
