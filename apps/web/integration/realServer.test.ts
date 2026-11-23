import 'fake-indexeddb/auto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@car-record/shared';
import { createApp, type ServerApp } from '../../server/src/app';
import { createDb, type CarDB } from '../src/db/db';
import { getRecord, listActive, saveRecord, savePhoto, softDelete } from '../src/db/repository';
import { createSyncEngine, type SyncEngine } from '../src/sync/engine';

interface Device {
  db: CarDB;
  engine: SyncEngine;
}

let dataDir: string;
let server: ServerApp;
let online = true;
const devices: CarDB[] = [];

function startServer(apiToken?: string): ServerApp {
  return createApp({ dataDir, apiToken });
}

/** fetch → in-process Hono app; throws like a real network failure when offline. */
function serverFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!online) throw new TypeError('Failed to fetch');
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return server.app.request(url, init);
  }) as typeof fetch;
}

function device(token?: string): Device {
  const db = createDb(`it-${uuidv7()}`);
  devices.push(db);
  const engine = createSyncEngine({
    db,
    fetch: serverFetch(),
    getToken: () => token,
    online: () => online,
  });
  return { db, engine };
}

beforeEach(() => {
  online = true;
  dataDir = mkdtempSync(join(tmpdir(), 'car-record-it-'));
  server = startServer();
});

afterEach(async () => {
  for (const db of devices.splice(0)) {
    db.close();
    await db.delete();
  }
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function addVehicleAndFuel(db: CarDB) {
  const vehicle = await saveRecord(db, 'vehicles', { name: '小白', fuelType: 'gasoline' });
  const fuel = await saveRecord(db, 'fuel', {
    vehicleId: vehicle.id,
    date: '2026-11-20',
    odometer: 52000,
    amount: 40,
    unitPrice: 30.1,
    cost: 1204,
    isFull: true,
  });
  return { vehicle, fuel };
}

describe('client ↔ real server', () => {
  it('pushes local records, assigns server revs, and another device pulls them', async () => {
    const a = device();
    const b = device();
    const { vehicle, fuel } = await addVehicleAndFuel(a.db);

    const sa = await a.engine.syncNow();
    expect(sa).toMatchObject({ state: 'idle', pending: 0, failed: 0 });
    expect((await getRecord(a.db, 'fuel', fuel.id))?.rev).toBeGreaterThan(0);

    await b.engine.syncNow();
    expect((await getRecord(b.db, 'vehicles', vehicle.id))?.name).toBe('小白');
    expect((await listActive(b.db, 'fuel', vehicle.id)).map((r) => r.odometer)).toEqual([52000]);
  });

  it('queues writes while offline and delivers them once back online', async () => {
    const a = device();
    const b = device();
    online = false;
    const { fuel } = await addVehicleAndFuel(a.db);
    const offline = await a.engine.syncNow();
    expect(offline.state).toBe('offline');
    expect(offline.pending).toBe(2);

    online = true;
    expect(await a.engine.syncNow()).toMatchObject({ state: 'idle', pending: 0 });
    await b.engine.syncNow();
    expect(await getRecord(b.db, 'fuel', fuel.id)).toBeDefined();
  });

  it('propagates soft deletes and edits in both directions', async () => {
    const a = device();
    const b = device();
    const { vehicle, fuel } = await addVehicleAndFuel(a.db);
    await a.engine.syncNow();
    await b.engine.syncNow();

    await saveRecord(b.db, 'vehicles', { ...vehicle, name: '小白 2 號' });
    await softDelete(b.db, 'fuel', fuel.id);
    await b.engine.syncNow();
    await a.engine.syncNow();

    expect((await getRecord(a.db, 'vehicles', vehicle.id))?.name).toBe('小白 2 號');
    expect((await getRecord(a.db, 'fuel', fuel.id))?.deletedAt).toBeDefined();
    expect(await listActive(a.db, 'fuel', vehicle.id)).toEqual([]);
  });

  it('resolves conflicting offline edits by server receive order and keeps history', async () => {
    const a = device();
    const b = device();
    const { vehicle } = await addVehicleAndFuel(a.db);
    await a.engine.syncNow();
    await b.engine.syncNow();

    online = false;
    await saveRecord(a.db, 'vehicles', { ...vehicle, name: 'A 改的' });
    await saveRecord(b.db, 'vehicles', { ...vehicle, name: 'B 改的' });
    online = true;
    await a.engine.syncNow();
    await b.engine.syncNow(); // B pushed last → wins
    await a.engine.syncNow();

    expect((await getRecord(a.db, 'vehicles', vehicle.id))?.name).toBe('B 改的');
    expect((await getRecord(b.db, 'vehicles', vehicle.id))?.name).toBe('B 改的');

    const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
    const raw = new DatabaseSync(join(dataDir, 'app.db'), { readOnly: true });
    const rows = raw
      .prepare('SELECT data FROM record_history WHERE table_name = ? AND id = ?')
      .all('vehicles', vehicle.id) as { data: string }[];
    raw.close();
    expect(rows.map((r) => (JSON.parse(r.data) as { name: string }).name)).toContain('A 改的');
  });

  it('uploads photos, drops the local blob, and serves them back', async () => {
    const a = device();
    const id = await savePhoto(a.db, new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' }));
    await a.engine.syncNow();

    const local = await a.db.photos.get(id);
    expect(local?.status).toBe('uploaded');
    expect(local?.blob).toBeUndefined();

    const res = await server.app.request(`/api/photos/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));
  });

  it('data survives a server restart; a brand-new device gets everything', async () => {
    const a = device();
    const { vehicle, fuel } = await addVehicleAndFuel(a.db);
    await a.engine.syncNow();

    server.close();
    server = startServer();

    const fresh = device();
    await fresh.engine.syncNow();
    expect(await getRecord(fresh.db, 'vehicles', vehicle.id)).toBeDefined();
    expect(await getRecord(fresh.db, 'fuel', fuel.id)).toBeDefined();
  });

  it('respects the API token', async () => {
    server.close();
    server = startServer('secret');

    const noToken = device();
    await addVehicleAndFuel(noToken.db);
    const denied = await noToken.engine.syncNow();
    expect(denied.state).toBe('error');
    expect(denied.lastError).toBe('unauthorized');
    expect(denied.pending).toBe(2);

    const withToken = device('secret');
    await addVehicleAndFuel(withToken.db);
    expect(await withToken.engine.syncNow()).toMatchObject({ state: 'idle', pending: 0 });
  });
});
