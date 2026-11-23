import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import {
  IonContent,
  IonHeader,
  IonLabel,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { useVehicleContext } from '../../app/vehicleContext';
import { buildStats, swipeDirection, type StatsPeriod } from './statsModel';

// Chart.js is loaded only when the stats tab is opened.
const StatsCharts = lazy(() => import('./StatsCharts'));

export function StatsPage() {
  const { vehicle, data, today } = useVehicleContext();
  const [period, setPeriod] = useState<StatsPeriod>(6);
  const stats = useMemo(() => buildStats(data, today, period), [data, today, period]);
  const start = useRef<{ x: number; y: number } | null>(null);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>統計</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSegment value={String(period)} onIonChange={(e) => setPeriod(Number(e.detail.value) === 12 ? 12 : 6)}>
            <IonSegmentButton value="6">
              <IonLabel>6 個月</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="12">
              <IonLabel>12 個月</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div
          className="stats-swipe"
          onTouchStart={(e) => {
            const t = e.touches[0];
            start.current = t ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchEnd={(e) => {
            const t = e.changedTouches[0];
            if (!start.current || !t) return;
            // Ignore swipes that started on a chart (dragging there shows values).
            const fromChart = (e.target as HTMLElement).closest?.('canvas');
            const dir = fromChart ? null : swipeDirection(t.clientX - start.current.x, t.clientY - start.current.y);
            start.current = null;
            if (dir === 'left') setPeriod(12);
            if (dir === 'right') setPeriod(6);
          }}
        >
          <Suspense
            fallback={
              <div className="empty">
                <IonSpinner />
              </div>
            }
          >
            <StatsCharts stats={stats} fuelType={vehicle.fuelType} />
          </Suspense>
          <div className="field-hint" style={{ margin: '12px 20px 32px', textAlign: 'center' }}>
            {stats.range.from} ～ {stats.range.to} · 左右滑切換期間 · 點圖表看數值
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
