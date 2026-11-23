import { useIonActionSheet } from '@ionic/react';
import { useFormSheet } from './FormSheet';
import { useLongPress } from '../hooks/useLongPress';
import { useVehicleContext } from './vehicleContext';

/**
 * Centre ➕ in the tab bar (SPEC §5.2): tap → 加油／保養／費用, long-press → 加油 directly.
 * `isTabButton` lets IonTabBar render it; the injected href/onClick props are ignored.
 */
export function AddTabButton(_props: { tab: string }) {
  const sheet = useFormSheet();
  const { vehicle } = useVehicleContext();
  const [present] = useIonActionSheet();
  const ev = vehicle.fuelType === 'ev';

  const openMenu = () =>
    void present({
      header: '新增紀錄',
      buttons: [
        { text: ev ? '⚡ 充電' : '⛽ 加油', handler: () => sheet.open({ kind: 'fuel' }) },
        { text: '🔧 保養維修', handler: () => sheet.open({ kind: 'maintenance' }) },
        { text: '🧾 其他費用', handler: () => sheet.open({ kind: 'expense' }) },
        { text: '取消', role: 'cancel' },
      ],
    });

  const handlers = useLongPress(() => sheet.open({ kind: 'fuel' }), { onClick: openMenu, delay: 450 });

  return (
    <button type="button" className="add-tab-button no-callout" aria-label="新增紀錄（長按直接記加油）" {...handlers}>
      <span className="add-circle" aria-hidden="true">
        ＋
      </span>
    </button>
  );
}
AddTabButton.isTabButton = true;
