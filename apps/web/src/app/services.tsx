import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CarDB } from '../db/db';
import type { SyncEngine, SyncStatus } from '../sync/engine';

export interface Services {
  db: CarDB;
  engine: SyncEngine;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider(props: { services: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={props.services}>{props.children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('useServices must be used inside <ServicesProvider>');
  return s;
}

const INITIAL: SyncStatus = { state: 'idle', pending: 0, failed: 0 };

export function useSyncStatus(): SyncStatus {
  const { engine } = useServices();
  const [status, setStatus] = useState<SyncStatus>(() => {
    try {
      return engine.getStatus();
    } catch {
      return INITIAL;
    }
  });
  useEffect(() => engine.subscribe(setStatus), [engine]);
  return status;
}

/**
 * Stand-in used when the real engine cannot be created: the app keeps working locally and
 * the sync chip shows the error.
 */
export function createFailedEngine(message: string): SyncEngine {
  const status: SyncStatus = { state: 'error', pending: 0, failed: 0, lastError: message };
  return {
    syncNow: async () => status,
    retryFailed: async () => status,
    start: () => {},
    stop: () => {},
    getStatus: () => status,
    subscribe: (listener) => {
      listener(status);
      return () => {};
    },
  };
}
