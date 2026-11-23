import { useRef } from 'react';
import {
  IonButtons,
  IonContent,
  IonHeader,
  IonList,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { Link } from 'react-router-dom';
import { useServices, useSyncStatus } from '../../app/services';
import { useVehicleContext, useVehicleSelection } from '../../app/vehicleContext';
import { useFormSheet } from '../../app/FormSheet';
import { SyncChip } from '../../components/SyncChip';
import { formatKm, formatNumber } from '../../lib/format';
import { swipeDirection } from '../stats/statsModel';
import { DeadlineItem, ReminderItem } from '../reminders/ReminderItems';
import { economyUnit } from './dashboardModel';

const HOME_REMINDER_LIMIT = 5;

function VehicleCard() {
  const { vehicle, state } = useVehicleContext();
  const { vehicles, setCurrentId } = useVehicleSelection();
  const start = useRef<{ x: number; y: number } | null>(null);
  const index = vehicles.findIndex((v) => v.id === vehicle.id);
  const multi = vehicles.length > 1;
  const go = (delta: number) => {
    const next = vehicles[(index + delta + vehicles.length) % vehicles.length];
    if (next) setCurrentId(next.id);
  };
  const est = state.estimate;

  return (
    <div
      className="card odo-card"
      onTouchStart={(e) => {
        const t = e.touches[0];
        start.current = t ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const t = e.changedTouches[0];
        if (!multi || !start.current || !t) return;
        const dir = swipeDirection(t.clientX - start.current.x, t.clientY - start.current.y);
        start.current = null;
        if (dir === 'left') go(1);
        if (dir === 'right') go(-1);
      }}
    >
      <div className="vehicle-switch">
        {multi ? (
          <button type="button" aria-label="上一台車" onClick={() => go(-1)}>
            ‹
          </button>
        ) : (
          <span />
        )}
        <span className="vehicle-name">{vehicle.name}</span>
        {multi ? (
          <button type="button" aria-label="下一台車" onClick={() => go(1)}>
            ›
          </button>
        ) : (
          <span />
        )}
      </div>
      <div className="odo-label">{est?.isEstimated ? '預估目前里程' : '目前里程'}</div>
      <div className="odo-value">{est ? formatKm(est.value) : '— km'}</div>
      <div className="odo-sub">
        {est
          ? `上次紀錄 ${formatKm(est.last.odometer)}（${est.last.date}）${est.dailyKm ? ` · 每日約 ${formatNumber(est.dailyKm, 1)} km` : ''}`
          : '記一筆加油或保養後開始推估'}
      </div>
      {multi ? (
        <div className="dots" aria-hidden="true">
          {vehicles.map((v) => (
            <span key={v.id} className={v.id === vehicle.id ? 'on' : ''} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EconomyCard() {
  const { vehicle, state } = useVehicleContext();
  const unit = economyUnit(vehicle.fuelType);
  if (!state.latestEconomy) {
    return (
      <div className="card muted" style={{ fontSize: 14 }}>
        需要兩次「{vehicle.fuelType === 'ev' ? '充飽' : '加滿'}」的紀錄才能計算{vehicle.fuelType === 'ev' ? '電耗' : '油耗'}。
      </div>
    );
  }
  const a = state.anomaly;
  return (
    <div className="card">
      <div className="economy-row">
        <div>
          <div className="big">{formatNumber(state.latestEconomy.kmPerUnit, 1)}</div>
          <div className="small">最近 {unit}</div>
        </div>
        <div>
          <div className="big">{state.averageEconomy !== null ? formatNumber(state.averageEconomy, 1) : '—'}</div>
          <div className="small">平均 {unit}</div>
        </div>
        <div>
          <div className="big">{formatNumber(state.latestEconomy.distanceKm)}</div>
          <div className="small">這次行駛 km</div>
        </div>
      </div>
      {a ? (
        <div className="hint-box" role="status">
          ⚠ 最近油耗 {formatNumber(a.latest.kmPerUnit, 1)} {unit}，比平均 {formatNumber(a.average, 1)} 差了{' '}
          {Math.round(a.dropRatio * 100)}%，可能要檢查胎壓、保養狀況或駕駛習慣。
        </div>
      ) : null}
    </div>
  );
}

export function HomePage() {
  const { engine } = useServices();
  const status = useSyncStatus();
  const { state } = useVehicleContext();
  const sheet = useFormSheet();

  const urgent = state.reminders.filter((r) => r.level !== 'ok');
  const shownReminders = (urgent.length > 0 ? urgent : state.reminders).slice(0, HOME_REMINDER_LIMIT);
  const deadlines = state.deadlines.filter((d) => d.level !== 'ok').concat(state.deadlines.filter((d) => d.level === 'ok')).slice(0, 3);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>首頁</IonTitle>
          <IonButtons slot="end" style={{ paddingRight: 8 }}>
            <SyncChip status={status} onTap={() => void engine.syncNow()} />
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonRefresher
          slot="fixed"
          onIonRefresh={(e) => {
            void engine.syncNow().finally(() => e.detail.complete());
          }}
        >
          <IonRefresherContent />
        </IonRefresher>

        <VehicleCard />

        <div className="section-title">
          <span>保養提醒</span>
          <Link to="/reminders">全部</Link>
        </div>
        {shownReminders.length > 0 ? (
          <IonList className="inset-list">
            {shownReminders.map((s) => (
              <ReminderItem key={s.rule.id} status={s} />
            ))}
          </IonList>
        ) : (
          <div className="card empty">
            還沒有提醒規則。
            <br />
            <button type="button" className="plain-button" style={{ marginTop: 8, padding: '0 16px' }} onClick={() => sheet.open({ kind: 'reminderRule' })}>
              新增提醒規則
            </button>
          </div>
        )}
        {urgent.length === 0 && state.reminders.length > 0 ? (
          <div className="field-hint" style={{ margin: '6px 20px' }}>
            👍 目前沒有快到期的保養
          </div>
        ) : null}
        <div className="field-hint" style={{ margin: '6px 20px' }}>
          右滑：完成並記錄保養 · 左滑：延後 · 點一下：更多動作
        </div>

        <div className="section-title">
          <span>證件與費用到期</span>
          <button type="button" onClick={() => sheet.open({ kind: 'deadline' })}>
            新增
          </button>
        </div>
        {deadlines.length > 0 ? (
          <IonList className="inset-list">
            {deadlines.map((d) => (
              <DeadlineItem key={d.deadline.id} status={d} />
            ))}
          </IonList>
        ) : (
          <div className="card empty">保險、驗車、牌照稅等到期日可以加在這裡。</div>
        )}

        <div className="section-title">
          <span>油耗</span>
          <Link to="/stats">統計</Link>
        </div>
        <EconomyCard />
        <div style={{ height: 24 }} />
      </IonContent>
    </IonPage>
  );
}
