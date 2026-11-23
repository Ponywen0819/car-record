import { useRef } from 'react';
import {
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
  IonNote,
  IonProgressBar,
  useIonActionSheet,
} from '@ionic/react';
import type { DeadlineStatus, ReminderStatus } from '../../domain';
import { useServices } from '../../app/services';
import { useVehicleContext } from '../../app/vehicleContext';
import { useFormSheet } from '../../app/FormSheet';
import { useNotify } from '../../app/useNotify';
import { useLongPress } from '../../hooks/useLongPress';
import { deadlineSummary, LEVEL_COLORS, reminderSummary } from '../dashboard/dashboardModel';
import { completeDeadlineWithUndo, snoozeAmount, snoozeWithUndo } from '../dashboard/undoableActions';

const LEVEL_TEXT: Record<string, string> = { overdue: '已逾期', soon: '即將到期', unknown: '未知', ok: '正常' };

function snoozeText(s: ReminderStatus): string {
  const by = snoozeAmount(s.rule);
  return [by.km ? `+${by.km} km` : '', by.days ? `+${by.days} 天` : ''].filter(Boolean).join(' / ');
}

/**
 * Reminder row: swipe right = done (opens the maintenance form with the item preselected),
 * swipe left = snooze. Tap / long-press opens the same actions as a menu.
 */
export function ReminderItem(props: { status: ReminderStatus }) {
  const s = props.status;
  const { db } = useServices();
  const { state, today } = useVehicleContext();
  const sheet = useFormSheet();
  const notify = useNotify();
  const [present] = useIonActionSheet();
  const sliding = useRef<HTMLIonItemSlidingElement>(null);

  const done = () => {
    void sliding.current?.close();
    sheet.open({ kind: 'maintenance', preselect: [s.rule.itemKey] });
  };
  const snooze = () => {
    void sliding.current?.close();
    void notify.runUndoable(() =>
      snoozeWithUndo(db, s.rule, { currentOdometer: state.estimate?.value ?? null, today }),
    );
  };
  const menu = () =>
    void present({
      header: s.rule.label,
      subHeader: reminderSummary(s),
      buttons: [
        { text: s.level === 'unknown' ? '登錄上次保養' : '完成並記錄保養', handler: done },
        { text: `延後提醒（${snoozeText(s)}）`, handler: snooze },
        { text: '編輯提醒規則', handler: () => sheet.open({ kind: 'reminderRule', record: s.rule }) },
        { text: '取消', role: 'cancel' },
      ],
    });
  const press = useLongPress(menu, { onClick: menu });

  return (
    <IonItemSliding ref={sliding}>
      <IonItemOptions side="start" onIonSwipe={done}>
        <IonItemOption color="success" expandable onClick={done}>
          完成
        </IonItemOption>
      </IonItemOptions>
      <IonItem button detail={false} className="press-item no-callout" {...press}>
        <span slot="start" className={`level-dot level-${s.level}`} aria-label={LEVEL_TEXT[s.level]} />
        <IonLabel>
          <h3>{s.rule.label}</h3>
          <p>{reminderSummary(s)}</p>
          {s.level !== 'unknown' ? (
            <IonProgressBar
              className="reminder-progress"
              value={Math.min(1, Math.max(0, s.progress))}
              color={LEVEL_COLORS[s.level]}
            />
          ) : null}
        </IonLabel>
        <IonNote slot="end" color={LEVEL_COLORS[s.level]}>
          {s.snoozed ? '已延後' : LEVEL_TEXT[s.level]}
        </IonNote>
      </IonItem>
      <IonItemOptions side="end" onIonSwipe={snooze}>
        <IonItemOption color="warning" expandable onClick={snooze}>
          延後
        </IonItemOption>
      </IonItemOptions>
    </IonItemSliding>
  );
}

/** Deadline row: swipe right = done (rolls forward or removes, with undo); tap = menu. */
export function DeadlineItem(props: { status: DeadlineStatus }) {
  const d = props.status;
  const { db } = useServices();
  const { today } = useVehicleContext();
  const sheet = useFormSheet();
  const notify = useNotify();
  const [present] = useIonActionSheet();
  const sliding = useRef<HTMLIonItemSlidingElement>(null);

  const complete = () => {
    void sliding.current?.close();
    void notify.runUndoable(() => completeDeadlineWithUndo(db, d.deadline, today));
  };
  const edit = () => {
    void sliding.current?.close();
    sheet.open({ kind: 'deadline', record: d.deadline });
  };
  const menu = () =>
    void present({
      header: d.deadline.label,
      subHeader: deadlineSummary(d),
      buttons: [
        { text: d.deadline.repeatEveryMonths ? '標記完成（排下一次）' : '標記完成', handler: complete },
        { text: '編輯', handler: edit },
        { text: '取消', role: 'cancel' },
      ],
    });
  const press = useLongPress(menu, { onClick: menu });

  return (
    <IonItemSliding ref={sliding}>
      <IonItemOptions side="start" onIonSwipe={complete}>
        <IonItemOption color="success" expandable onClick={complete}>
          完成
        </IonItemOption>
      </IonItemOptions>
      <IonItem button detail={false} className="press-item no-callout" {...press}>
        <span slot="start" className={`level-dot level-${d.level}`} aria-label={LEVEL_TEXT[d.level]} />
        <IonLabel>
          <h3>{d.deadline.label}</h3>
          <p>{deadlineSummary(d)}</p>
        </IonLabel>
        <IonNote slot="end" color={LEVEL_COLORS[d.level]}>
          {LEVEL_TEXT[d.level]}
        </IonNote>
      </IonItem>
      <IonItemOptions side="end">
        <IonItemOption color="medium" onClick={edit}>
          編輯
        </IonItemOption>
      </IonItemOptions>
    </IonItemSliding>
  );
}
