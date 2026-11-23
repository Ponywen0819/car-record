/**
 * Engine test helpers (not a test file itself).
 */
import type { CarDB } from '../../db/db';
import { createSyncEngine, type SyncEngine, type SyncEngineOptions, type SyncStatus } from '../engine';
import { disposeDb, makeTestDb } from '../../db/__tests__/fixtures';
import { createFakeServer, type FakeServer } from './fakeServer';

export interface Harness {
  db: CarDB;
  server: FakeServer;
  engine: SyncEngine;
  clock: { now: number };
  net: { online: boolean };
  dispose(): Promise<void>;
}

/** One device (db + engine) talking to `server` (a fresh one unless shared). */
export function makeHarness(
  opts: Partial<SyncEngineOptions> & { server?: FakeServer } = {},
): Harness {
  const { server: shared, ...engineOpts } = opts;
  const db = makeTestDb();
  const server = shared ?? createFakeServer();
  const clock = { now: 1_000_000 };
  const net = { online: true };
  const engine = createSyncEngine({
    db,
    baseUrl: '',
    fetch: server.fetch,
    now: () => clock.now,
    online: () => net.online,
    ...engineOpts,
  });
  return {
    db,
    server,
    engine,
    clock,
    net,
    async dispose() {
      engine.stop();
      await disposeDb(db);
    },
  };
}

/** Yield real macrotasks (fake-indexeddb runs on setImmediate, which tests never fake). */
export function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Let any in-flight sync run finish (works with fake timers, does not advance them). */
export async function settle(engine: SyncEngine, extraTicks = 30): Promise<void> {
  for (let i = 0; i < 5000 && engine.getStatus().state === 'syncing'; i++) await tick();
  for (let i = 0; i < extraTicks; i++) await tick();
}

export function recorder(engine: SyncEngine): { statuses: SyncStatus[]; unsubscribe: () => void } {
  const statuses: SyncStatus[] = [];
  const unsubscribe = engine.subscribe((s) => statuses.push({ ...s }));
  return { statuses, unsubscribe };
}
