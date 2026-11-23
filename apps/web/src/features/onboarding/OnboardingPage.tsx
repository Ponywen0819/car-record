import { useCallback } from 'react';
import { IonPage } from '@ionic/react';
import type { Vehicle } from '@car-record/shared';
import { useVehicleSelection } from '../../app/vehicleContext';
import { useNotify } from '../../app/useNotify';
import { VehicleForm } from '../vehicle/VehicleForm';

/** First run: no vehicle yet → create one (default reminder rules are created with it). */
export function OnboardingPage() {
  const { setCurrentId } = useVehicleSelection();
  const notify = useNotify();
  const noop = useCallback(() => {}, []);
  const onSaved = useCallback(
    (_message: string, record?: unknown) => {
      if (record) setCurrentId((record as Vehicle).id);
      notify.toast('✓ 已建立車輛，並加入預設保養提醒', 'success');
    },
    [setCurrentId, notify],
  );

  return (
    <IonPage>
      <VehicleForm
        chrome="standalone"
        title="歡迎使用車輛記錄"
        expanded={false}
        onExpand={noop}
        onDirtyChange={noop}
        onCancel={noop}
        onSaved={onSaved}
        intro={
          <p className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
            先建立第一台車。名稱和燃料類型就夠了，其他資料之後都可以在「設定」補上。
            建立後會自動加入機油、濾網、煞車油等預設保養提醒。
          </p>
        }
      />
    </IonPage>
  );
}
