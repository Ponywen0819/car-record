import { useEffect, useRef, useState } from 'react';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonTitle,
  IonToggle,
  IonToolbar,
  useIonActionSheet,
} from '@ionic/react';
import { checkmarkCircle, ellipseOutline } from 'ionicons/icons';
import { FUEL_TYPE_LABELS, type Deadline, type ReminderRule, type Vehicle } from '@car-record/shared';
import pkg from '../../../package.json';
import { useServices, useSyncStatus } from '../../app/services';
import { useVehicleContext, useVehicleSelection } from '../../app/vehicleContext';
import { useFormSheet } from '../../app/FormSheet';
import { useNotify } from '../../app/useNotify';
import { getApiToken, setApiToken } from '../../app/prefs';
import { saveRecord, type Draft } from '../../db/repository';
import { syncChipInfo } from '../../components/SyncChip';
import { useLongPress } from '../../hooks/useLongPress';
import { formatNumber } from '../../lib/format';
import { errorMessage, toDraft } from '../forms/formKit';
import { deleteWithUndo } from '../dashboard/undoableActions';
import { CSV_COLUMNS, TABLE_LABELS } from './exportModel';
import { useExporters, type CsvTable } from './useExporters';

function VehicleRow(props: { vehicle: Vehicle; current: boolean }) {
  const { vehicle: v } = props;
  const { db } = useServices();
  const { vehicles, setCurrentId } = useVehicleSelection();
  const sheet = useFormSheet();
  const notify = useNotify();
  const [present] = useIonActionSheet();
  const sliding = useRef<HTMLIonItemSlidingElement>(null);

  const edit = () => {
    void sliding.current?.close();
    sheet.open({ kind: 'vehicle', record: v });
  };
  const remove = () => {
    if (props.current) {
      const other = vehicles.find((x) => x.id !== v.id);
      if (other) setCurrentId(other.id);
    }
    void notify.runUndoable(async () => {
      const u = await deleteWithUndo(db, 'vehicles', v.id, `「${v.name}」`);
      return {
        message: u.message,
        undo: async () => {
          await u.undo();
          setCurrentId(v.id);
        },
      };
    });
  };
  const menu = () =>
    void present({
      header: v.name,
      buttons: [
        { text: '切換到這台車', handler: () => setCurrentId(v.id) },
        { text: '編輯', handler: edit },
        { text: '刪除', role: 'destructive', handler: remove },
        { text: '取消', role: 'cancel' },
      ],
    });
  const press = useLongPress(menu, { onClick: () => setCurrentId(v.id) });

  return (
    <IonItemSliding ref={sliding}>
      <IonItem button detail={false} className="press-item no-callout" {...press}>
        <IonIcon slot="start" icon={props.current ? checkmarkCircle : ellipseOutline} color={props.current ? 'primary' : 'medium'} />
        <IonLabel>
          <h3>{v.name}</h3>
          <p>{[v.plate, v.brand, v.model, FUEL_TYPE_LABELS[v.fuelType]].filter(Boolean).join(' · ')}</p>
        </IonLabel>
        <IonButton slot="end" fill="clear" onClick={(e) => { e.stopPropagation(); edit(); }}>
          編輯
        </IonButton>
      </IonItem>
      <IonItemOptions side="end" onIonSwipe={remove}>
        <IonItemOption color="danger" expandable onClick={remove}>
          刪除
        </IonItemOption>
      </IonItemOptions>
    </IonItemSliding>
  );
}

function ruleInterval(r: ReminderRule): string {
  return [r.everyKm ? `每 ${formatNumber(r.everyKm)} km` : '', r.everyMonths ? `每 ${r.everyMonths} 個月` : '']
    .filter(Boolean)
    .join('／');
}

function RuleRow(props: { rule: ReminderRule }) {
  const { rule } = props;
  const { db } = useServices();
  const sheet = useFormSheet();
  const notify = useNotify();
  const remove = () => void notify.runUndoable(() => deleteWithUndo(db, 'reminderRules', rule.id, `「${rule.label}」提醒`));
  const toggle = (enabled: boolean) => {
    saveRecord(db, 'reminderRules', { ...toDraft(rule), enabled } as Draft<'reminderRules'>).catch((e) =>
      notify.toast(`儲存失敗：${errorMessage(e)}`, 'danger'),
    );
  };
  return (
    <IonItemSliding>
      <IonItem button detail onClick={() => sheet.open({ kind: 'reminderRule', record: rule })}>
        <IonLabel>
          <h3>{rule.label}</h3>
          <p>{ruleInterval(rule)}{rule.snoozeUntilDate || rule.snoozeUntilOdometer ? ' · 已延後' : ''}</p>
        </IonLabel>
        <IonToggle
          slot="end"
          checked={rule.enabled}
          aria-label={`啟用 ${rule.label}`}
          onClick={(e) => e.stopPropagation()}
          onIonChange={(e) => toggle(e.detail.checked)}
        />
      </IonItem>
      <IonItemOptions side="end" onIonSwipe={remove}>
        <IonItemOption color="danger" expandable onClick={remove}>
          刪除
        </IonItemOption>
      </IonItemOptions>
    </IonItemSliding>
  );
}

function DeadlineRow(props: { deadline: Deadline }) {
  const { deadline: d } = props;
  const { db } = useServices();
  const sheet = useFormSheet();
  const notify = useNotify();
  const remove = () => void notify.runUndoable(() => deleteWithUndo(db, 'deadlines', d.id, `「${d.label}」`));
  return (
    <IonItemSliding>
      <IonItem button detail onClick={() => sheet.open({ kind: 'deadline', record: d })}>
        <IonLabel>
          <h3>{d.label}</h3>
          <p>
            {d.dueDate} · 提前 {d.remindDaysBefore} 天{d.repeatEveryMonths ? ` · 每 ${d.repeatEveryMonths} 個月` : ''}
          </p>
        </IonLabel>
      </IonItem>
      <IonItemOptions side="end" onIonSwipe={remove}>
        <IonItemOption color="danger" expandable onClick={remove}>
          刪除
        </IonItemOption>
      </IonItemOptions>
    </IonItemSliding>
  );
}

function SyncSection() {
  const { engine } = useServices();
  const status = useSyncStatus();
  const notify = useNotify();
  const [token, setToken] = useState(() => getApiToken() ?? '');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const info = syncChipInfo(status);

  useEffect(() => {
    navigator.storage
      ?.persisted?.()
      .then(setPersisted)
      .catch(() => setPersisted(null));
  }, []);

  return (
    <>
      <div className="section-title">
        <span>同步</span>
      </div>
      <IonList className="inset-list">
        <IonItem>
          <IonLabel>
            <h3>狀態</h3>
            <p>
              {info.label}
              {status.lastSyncAt ? ` · 上次同步 ${new Date(status.lastSyncAt).toLocaleString('zh-TW')}` : ''}
            </p>
          </IonLabel>
        </IonItem>
        <IonItem button detail={false} onClick={() => void engine.syncNow()}>
          <IonLabel color="primary">立即同步</IonLabel>
        </IonItem>
        {status.failed > 0 ? (
          <IonItem button detail={false} onClick={() => void engine.retryFailed()}>
            <IonLabel color="danger">重試 {status.failed} 筆失敗的變更</IonLabel>
          </IonItem>
        ) : null}
        <IonItem lines="none">
          <IonLabel>
            <h3>API Token（選用）</h3>
            <p>server 有設定 API_TOKEN 時才需要</p>
          </IonLabel>
        </IonItem>
        <div style={{ padding: '0 16px 12px' }}>
          <div className="button-row">
            <input
              className="input"
              type="password"
              autoComplete="off"
              aria-label="API Token"
              value={token}
              placeholder="未設定"
              onChange={(e) => setToken(e.target.value)}
              style={{ flex: 3 }}
            />
            <button
              type="button"
              className="plain-button"
              onClick={() => {
                setApiToken(token);
                notify.toast(token.trim() ? '已儲存 Token' : '已清除 Token');
                void engine.syncNow();
              }}
            >
              儲存
            </button>
          </div>
        </div>
        {persisted !== null ? (
          <IonItem lines="none">
            <IonLabel>
              <p>本機儲存：{persisted ? '已啟用持久化' : '可能被系統清除（未上傳的變更有遺失風險）'}</p>
            </IonLabel>
          </IonItem>
        ) : null}
      </IonList>
    </>
  );
}

export function SettingsPage() {
  const { vehicle, data } = useVehicleContext();
  const { vehicles } = useVehicleSelection();
  const sheet = useFormSheet();
  const exporters = useExporters();
  const [presentSheet] = useIonActionSheet();
  const importInput = useRef<HTMLInputElement>(null);

  const chooseCsv = () =>
    void presentSheet({
      header: '匯出 CSV',
      buttons: [
        ...(Object.keys(CSV_COLUMNS) as CsvTable[]).map((t) => ({
          text: TABLE_LABELS[t],
          handler: () => void exporters.exportCsv(t),
        })),
        { text: '取消', role: 'cancel' },
      ],
    });

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>設定</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="section-title">
          <span>車輛</span>
          <button type="button" onClick={() => sheet.open({ kind: 'vehicle' })}>
            新增車輛
          </button>
        </div>
        <IonList className="inset-list">
          {vehicles.map((v) => (
            <VehicleRow key={v.id} vehicle={v} current={v.id === vehicle.id} />
          ))}
        </IonList>

        <div className="section-title">
          <span>{vehicle.name} · 保養提醒規則</span>
          <button type="button" onClick={() => sheet.open({ kind: 'reminderRule' })}>
            新增
          </button>
        </div>
        {data.reminderRules.length > 0 ? (
          <IonList className="inset-list">
            {data.reminderRules.map((r) => (
              <RuleRow key={r.id} rule={r} />
            ))}
          </IonList>
        ) : (
          <div className="card empty">沒有提醒規則。</div>
        )}

        <div className="section-title">
          <span>證件與費用到期</span>
          <button type="button" onClick={() => sheet.open({ kind: 'deadline' })}>
            新增
          </button>
        </div>
        {data.deadlines.length > 0 ? (
          <IonList className="inset-list">
            {[...data.deadlines]
              .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
              .map((d) => (
                <DeadlineRow key={d.id} deadline={d} />
              ))}
          </IonList>
        ) : (
          <div className="card empty">保險、定期驗車、駕照、牌照稅、燃料費。</div>
        )}

        <div className="section-title">
          <span>資料匯出／匯入</span>
        </div>
        <IonList className="inset-list">
          <IonItem button detail onClick={() => void exporters.exportJson()}>
            <IonLabel>
              <h3>匯出備份（JSON）</h3>
              <p>所有車輛與紀錄</p>
            </IonLabel>
          </IonItem>
          <IonItem button detail onClick={chooseCsv}>
            <IonLabel>
              <h3>匯出 CSV</h3>
              <p>可用 Excel／Numbers 開啟</p>
            </IonLabel>
          </IonItem>
          <IonItem button detail onClick={() => void exporters.exportIcs()}>
            <IonLabel>
              <h3>提醒加入行事曆（.ics）</h3>
              <p>由 iOS 行事曆負責通知</p>
            </IonLabel>
          </IonItem>
          <IonItem button detail onClick={() => importInput.current?.click()}>
            <IonLabel>
              <h3>從 JSON 備份匯入</h3>
              <p>匯入前會先顯示內容並確認</p>
            </IonLabel>
          </IonItem>
        </IonList>
        <input
          ref={importInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void exporters.importJson(file);
          }}
        />

        <SyncSection />

        <div className="section-title">
          <span>關於</span>
        </div>
        <IonList className="inset-list">
          <IonItem>
            <IonLabel>版本</IonLabel>
            <IonNote slot="end">v{pkg.version}</IonNote>
          </IonItem>
        </IonList>
        <div style={{ height: 32 }} />
      </IonContent>
    </IonPage>
  );
}
