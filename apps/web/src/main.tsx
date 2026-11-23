import { createRoot } from 'react-dom/client';
import { setupIonicReact } from '@ionic/react';

import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';
import '@ionic/react/css/palettes/dark.system.css';
import './theme/global.css';

import App from './App';
import { createDb } from './db/db';
import { createSyncEngine, type SyncEngine } from './sync/engine';
import { createFailedEngine } from './app/services';
import { getApiToken } from './app/prefs';
import { parseAddPath } from './app/deepLink';
import { registerServiceWorker } from './app/registerServiceWorker';

setupIonicReact({ mode: 'ios' });

// Deep links from iOS Shortcuts / NFC (SPEC §5.4): open the form over the home tab.
const initialAdd = parseAddPath(window.location.pathname);
if (initialAdd) window.history.replaceState(null, '', '/home');

const db = createDb();
let engine: SyncEngine;
try {
  engine = createSyncEngine({ db, getToken: getApiToken });
  engine.start();
} catch (e) {
  console.error('sync engine unavailable', e);
  engine = createFailedEngine(e instanceof Error ? e.message : String(e));
}

if (import.meta.env.PROD) void registerServiceWorker();

// Ask iOS not to evict the local cache / outbox (SPEC §6).
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById('root')!).render(<App services={{ db, engine }} initialAdd={initialAdd} />);
