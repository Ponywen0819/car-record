import { useEffect } from 'react';
import { Redirect, Route } from 'react-router-dom';
import {
  IonApp,
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonSpinner,
  IonTabBar,
  IonTabButton,
  IonTabs,
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { homeOutline, listOutline, settingsOutline, statsChartOutline } from 'ionicons/icons';
import { ServicesProvider, type Services } from './app/services';
import { VehicleSelectionProvider, VehicleStateProvider, useVehicleContext, useVehicleSelection } from './app/vehicleContext';
import { FormSheetProvider } from './app/FormSheet';
import { AddTabButton } from './app/AddTabButton';
import { AddRoute } from './app/AddRoute';
import { ErrorBoundary } from './app/ErrorBoundary';
import { updateAppBadge } from './app/appBadge';
import { TAB_BAR_ID } from './app/useNotify';
import type { AddKind } from './app/deepLink';
import { badgeCount } from './features/dashboard/dashboardModel';
import { HomePage } from './features/dashboard/HomePage';
import { RecordsPage } from './features/records/RecordsPage';
import { EditRecordPage } from './features/records/EditRecordPage';
import { StatsPage } from './features/stats/StatsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { RemindersPage } from './features/reminders/RemindersPage';
import { OnboardingPage } from './features/onboarding/OnboardingPage';

function Splash() {
  return (
    <div className="splash">
      <IonSpinner />
    </div>
  );
}

function AppBadge() {
  const { state } = useVehicleContext();
  const count = badgeCount(state);
  useEffect(() => updateAppBadge(count), [count]);
  return null;
}

function Tabs() {
  return (
    <IonTabs>
      <IonRouterOutlet>
        <Route exact path="/home" component={HomePage} />
        <Route exact path="/records" component={RecordsPage} />
        <Route exact path="/records/:table/:id" component={EditRecordPage} />
        <Route exact path="/stats" component={StatsPage} />
        <Route exact path="/settings" component={SettingsPage} />
        <Route exact path="/reminders" component={RemindersPage} />
        <Route exact path="/add/:kind" component={AddRoute} />
        <Route exact path="/">
          <Redirect to="/home" />
        </Route>
      </IonRouterOutlet>
      <IonTabBar slot="bottom" id={TAB_BAR_ID}>
        <IonTabButton tab="home" href="/home">
          <IonIcon icon={homeOutline} aria-hidden="true" />
          <IonLabel>首頁</IonLabel>
        </IonTabButton>
        <IonTabButton tab="records" href="/records">
          <IonIcon icon={listOutline} aria-hidden="true" />
          <IonLabel>紀錄</IonLabel>
        </IonTabButton>
        <AddTabButton tab="add" />
        <IonTabButton tab="stats" href="/stats">
          <IonIcon icon={statsChartOutline} aria-hidden="true" />
          <IonLabel>統計</IonLabel>
        </IonTabButton>
        <IonTabButton tab="settings" href="/settings">
          <IonIcon icon={settingsOutline} aria-hidden="true" />
          <IonLabel>設定</IonLabel>
        </IonTabButton>
      </IonTabBar>
    </IonTabs>
  );
}

function Main(props: { initialAdd: AddKind | null }) {
  const { current } = useVehicleSelection();
  if (!current) return <OnboardingPage />;
  return (
    <VehicleStateProvider vehicleId={current.id} loading={<Splash />}>
      <AppBadge />
      <IonReactRouter>
        <FormSheetProvider initialRequest={props.initialAdd ? { kind: props.initialAdd } : null}>
          <Tabs />
        </FormSheetProvider>
      </IonReactRouter>
    </VehicleStateProvider>
  );
}

export default function App(props: { services: Services; initialAdd?: AddKind | null }) {
  return (
    <IonApp>
      <ErrorBoundary>
        <ServicesProvider services={props.services}>
          <VehicleSelectionProvider loading={<Splash />}>
            <Main initialAdd={props.initialAdd ?? null} />
          </VehicleSelectionProvider>
        </ServicesProvider>
      </ErrorBoundary>
    </IonApp>
  );
}
