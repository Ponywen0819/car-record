import { useEffect } from 'react';
import { IonPage, useIonRouter } from '@ionic/react';
import type { RouteComponentProps } from 'react-router-dom';
import { useFormSheet } from './FormSheet';
import { parseAddPath } from './deepLink';

/**
 * /add/fuel | /add/maintenance | /add/expense reached by in-app navigation: open the sheet
 * over the home tab. (Cold starts from iOS Shortcuts / NFC are handled in main.tsx before
 * the router mounts.)
 */
export function AddRoute(props: RouteComponentProps<{ kind: string }>) {
  const sheet = useFormSheet();
  const router = useIonRouter();
  const kind = parseAddPath(props.match.url);
  useEffect(() => {
    if (kind) sheet.open({ kind });
    router.push('/home', 'none', 'replace');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  return <IonPage />;
}
