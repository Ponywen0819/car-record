import { useMemo, useRef, useState } from 'react';
import {
  IonContent,
  IonHeader,
  IonItem,
  IonItemDivider,
  IonItemGroup,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
  useIonActionSheet,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { useServices } from '../../app/services';
import { useVehicleContext } from '../../app/vehicleContext';
import { useFormSheet } from '../../app/FormSheet';
import { useNotify } from '../../app/useNotify';
import type { FormRequest } from '../../app/formRequest';
import { useLongPress } from '../../hooks/useLongPress';
import { formatMoney } from '../../lib/format';
import { deleteWithUndo } from '../dashboard/undoableActions';
import { groupByMonth, TABLE_NOUNS, toRecordRows, type RecordFilter, type RecordRow } from './recordsModel';

const SEGMENTS: { value: RecordFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'fuel', label: '加油' },
  { value: 'maintenance', label: '保養' },
  { value: 'expenses', label: '費用' },
];

export function duplicateRequest(row: RecordRow): FormRequest {
  switch (row.table) {
    case 'fuel':
      return { kind: 'fuel', duplicateOf: row.record };
    case 'maintenance':
      return { kind: 'maintenance', duplicateOf: row.record };
    case 'expenses':
      return { kind: 'expense', duplicateOf: row.record };
  }
}

const ICONS: Record<RecordRow['table'], string> = { fuel: '⛽', maintenance: '🔧', expenses: '🧾' };

/**
 * Swipe left = delete (undo toast), swipe right = duplicate as a new record with today's
 * defaults, long-press = menu, tap = edit (SPEC §5.2).
 */
function RecordItem(props: { row: RecordRow }) {
  const { row } = props;
  const { db } = useServices();
  const sheet = useFormSheet();
  const notify = useNotify();
  const history = useHistory();
  const [present] = useIonActionSheet();
  const sliding = useRef<HTMLIonItemSlidingElement>(null);

  const edit = () => history.push(`/records/${row.table}/${row.id}`);
  const duplicate = () => {
    void sliding.current?.close();
    sheet.open(duplicateRequest(row));
  };
  const remove = () => {
    void notify.runUndoable(() => deleteWithUndo(db, row.table, row.id, TABLE_NOUNS[row.table]));
  };
  const menu = () =>
    void present({
      header: row.title,
      subHeader: row.date,
      buttons: [
        { text: '編輯', handler: edit },
        { text: '複製成新的一筆', handler: duplicate },
        { text: '刪除', role: 'destructive', handler: remove },
        { text: '取消', role: 'cancel' },
      ],
    });
  const press = useLongPress(menu, { onClick: edit });

  return (
    <IonItemSliding ref={sliding}>
      <IonItemOptions side="start" onIonSwipe={duplicate}>
        <IonItemOption color="primary" expandable onClick={duplicate}>
          複製
        </IonItemOption>
      </IonItemOptions>
      <IonItem button detail={false} className="press-item no-callout" {...press}>
        <span slot="start" aria-hidden="true" style={{ fontSize: 22 }}>
          {ICONS[row.table]}
        </span>
        <IonLabel>
          <h3>{row.title}</h3>
          <p>
            {row.date.slice(5).replace('-', '/')}
            {row.detail ? ` · ${row.detail}` : ''}
          </p>
        </IonLabel>
        {row.cost !== undefined ? (
          <IonNote slot="end" className="record-cost">
            {formatMoney(row.cost)}
          </IonNote>
        ) : null}
      </IonItem>
      <IonItemOptions side="end" onIonSwipe={remove}>
        <IonItemOption color="danger" expandable onClick={remove}>
          刪除
        </IonItemOption>
      </IonItemOptions>
    </IonItemSliding>
  );
}

export function RecordsPage() {
  const { vehicle, data } = useVehicleContext();
  const [filter, setFilter] = useState<RecordFilter>('all');
  const groups = useMemo(
    () => groupByMonth(toRecordRows(data, filter, vehicle.fuelType)),
    [data, filter, vehicle.fuelType],
  );

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>紀錄</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSegment value={filter} onIonChange={(e) => setFilter((e.detail.value as RecordFilter) ?? 'all')}>
            {SEGMENTS.map((s) => (
              <IonSegmentButton key={s.value} value={s.value}>
                <IonLabel>{s.label}</IonLabel>
              </IonSegmentButton>
            ))}
          </IonSegment>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {groups.length === 0 ? (
          <div className="empty">還沒有紀錄。點下方 ＋ 新增，長按 ＋ 直接記加油。</div>
        ) : (
          <IonList>
            {groups.map((g) => (
              <IonItemGroup key={g.month}>
                <IonItemDivider sticky>
                  <div className="month-header">
                    <span>{g.label}</span>
                    {g.total > 0 ? <span className="record-cost">{formatMoney(g.total)}</span> : null}
                  </div>
                </IonItemDivider>
                {g.rows.map((row) => (
                  <RecordItem key={`${row.table}-${row.id}`} row={row} />
                ))}
              </IonItemGroup>
            ))}
          </IonList>
        )}
        <div className="field-hint" style={{ margin: '12px 20px 32px', textAlign: 'center' }}>
          左滑刪除 · 右滑複製 · 長按更多
        </div>
      </IonContent>
    </IonPage>
  );
}

