import { useCallback } from 'react';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  useIonRouter,
} from '@ionic/react';
import type { RouteComponentProps } from 'react-router-dom';
import { useVehicleContext } from '../../app/vehicleContext';
import { FormHost } from '../../app/FormHost';
import type { FormRequest } from '../../app/formRequest';
import type { RecordTable } from './recordsModel';

/** /records/:table/:id — full-page edit of a fuel / maintenance / expense record. */
export function EditRecordPage(props: RouteComponentProps<{ table: string; id: string }>) {
  const { table, id } = props.match.params;
  const { data } = useVehicleContext();
  const router = useIonRouter();

  const request: FormRequest | null = (() => {
    switch (table as RecordTable) {
      case 'fuel': {
        const record = data.fuel.find((r) => r.id === id);
        return record ? { kind: 'fuel', record } : null;
      }
      case 'maintenance': {
        const record = data.maintenance.find((r) => r.id === id);
        return record ? { kind: 'maintenance', record } : null;
      }
      case 'expenses': {
        const record = data.expenses.find((r) => r.id === id);
        return record ? { kind: 'expense', record } : null;
      }
      default:
        return null;
    }
  })();

  const onClose = useCallback(() => {
    if (router.canGoBack()) router.goBack();
    else router.push('/records', 'back', 'replace');
  }, [router]);
  const noop = useCallback(() => {}, []);

  return (
    <IonPage>
      {request ? (
        <FormHost
          key={`${table}-${id}`}
          request={request}
          chrome="page"
          expanded
          onExpand={noop}
          onDirtyChange={noop}
          onClose={onClose}
        />
      ) : (
        <>
          <IonHeader>
            <IonToolbar>
              <IonButtons slot="start">
                <IonBackButton defaultHref="/records" text="返回" />
              </IonButtons>
              <IonTitle>紀錄</IonTitle>
            </IonToolbar>
          </IonHeader>
          <IonContent>
            <div className="empty">找不到這筆紀錄（可能已刪除，或屬於其他車輛）。</div>
          </IonContent>
        </>
      )}
    </IonPage>
  );
}
