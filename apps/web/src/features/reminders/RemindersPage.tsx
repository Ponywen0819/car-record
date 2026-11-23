import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonList,
  IonPage,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { useVehicleContext } from '../../app/vehicleContext';
import { useFormSheet } from '../../app/FormSheet';
import { useExporters } from '../settings/useExporters';
import { DeadlineItem, ReminderItem } from './ReminderItems';

/** /reminders — every reminder and deadline (deep link target, SPEC §5.4). */
export function RemindersPage() {
  const { vehicle, state } = useVehicleContext();
  const sheet = useFormSheet();
  const exporters = useExporters();

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/home" text="首頁" />
          </IonButtons>
          <IonTitle>提醒</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => void exporters.exportIcs()}>加入行事曆</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="section-title">
          <span>{vehicle.name} · 保養提醒</span>
          <button type="button" onClick={() => sheet.open({ kind: 'reminderRule' })}>
            新增
          </button>
        </div>
        {state.reminders.length > 0 ? (
          <IonList className="inset-list">
            {state.reminders.map((s) => (
              <ReminderItem key={s.rule.id} status={s} />
            ))}
          </IonList>
        ) : (
          <div className="card empty">沒有啟用的提醒規則。</div>
        )}

        <div className="section-title">
          <span>證件與費用到期</span>
          <button type="button" onClick={() => sheet.open({ kind: 'deadline' })}>
            新增
          </button>
        </div>
        {state.deadlines.length > 0 ? (
          <IonList className="inset-list">
            {state.deadlines.map((d) => (
              <DeadlineItem key={d.deadline.id} status={d} />
            ))}
          </IonList>
        ) : (
          <div className="card empty">尚未設定到期提醒。</div>
        )}
        <div className="field-hint" style={{ margin: '12px 20px 32px' }}>
          iPhone 網頁 App 無法在關閉時跳出通知：可用右上角「加入行事曆」把到期日匯出成 .ics，由行事曆負責提醒。
        </div>
      </IonContent>
    </IonPage>
  );
}
