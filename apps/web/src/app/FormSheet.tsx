import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { IonModal, useIonActionSheet } from '@ionic/react';
import type { FormRequest } from './formRequest';
import { FormHost } from './FormHost';

interface FormSheetApi {
  open: (request: FormRequest) => void;
}

const FormSheetContext = createContext<FormSheetApi | null>(null);

export function useFormSheet(): FormSheetApi {
  const api = useContext(FormSheetContext);
  if (!api) throw new Error('useFormSheet must be used inside <FormSheetProvider>');
  return api;
}

const BREAKPOINTS = [0, 0.88, 1];
const INITIAL_BREAKPOINT = 0.88;

/**
 * Add/edit forms as an iOS bottom sheet (SPEC §5.2): drag down to close (asks first when
 * there are unsaved changes), drag up / tap the handle / "more fields" to go full screen.
 */
export function FormSheetProvider(props: { children: ReactNode; initialRequest?: FormRequest | null }) {
  const [request, setRequest] = useState<FormRequest | null>(props.initialRequest ?? null);
  const [openCount, setOpenCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const dirty = useRef(false);
  const modal = useRef<HTMLIonModalElement>(null);
  const [presentSheet] = useIonActionSheet();

  const open = useCallback((r: FormRequest) => {
    dirty.current = false;
    setExpanded(false);
    setOpenCount((n) => n + 1);
    setRequest(r);
  }, []);

  const canDismiss = useCallback(
    async (_data?: unknown, role?: string): Promise<boolean> => {
      if (role === 'saved' || !dirty.current) return true;
      return new Promise<boolean>((resolve) => {
        void presentSheet({
          header: '要捨棄尚未儲存的內容嗎？',
          buttons: [
            { text: '捨棄', role: 'destructive' },
            { text: '繼續編輯', role: 'cancel' },
          ],
          onDidDismiss: (e) => resolve(e.detail.role === 'destructive'),
        });
      });
    },
    [presentSheet],
  );

  const onClose = useCallback((saved: boolean) => {
    void modal.current?.dismiss(undefined, saved ? 'saved' : 'cancel');
  }, []);
  const onExpand = useCallback(() => {
    void modal.current?.setCurrentBreakpoint(1);
    setExpanded(true);
  }, []);
  const onDirtyChange = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);

  const api = useMemo(() => ({ open }), [open]);

  return (
    <FormSheetContext.Provider value={api}>
      {props.children}
      <IonModal
        ref={modal}
        isOpen={request !== null}
        breakpoints={BREAKPOINTS}
        initialBreakpoint={INITIAL_BREAKPOINT}
        handleBehavior="cycle"
        expandToScroll={false}
        canDismiss={canDismiss}
        onIonBreakpointDidChange={(e) => setExpanded(e.detail.breakpoint === 1)}
        onDidDismiss={() => {
          dirty.current = false;
          setRequest(null);
        }}
      >
        {request ? (
          <FormHost
            key={openCount}
            request={request}
            chrome="sheet"
            expanded={expanded}
            onExpand={onExpand}
            onDirtyChange={onDirtyChange}
            onClose={onClose}
          />
        ) : null}
      </IonModal>
    </FormSheetContext.Provider>
  );
}
