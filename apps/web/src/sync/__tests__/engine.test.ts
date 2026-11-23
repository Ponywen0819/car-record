import { afterEach, describe, expect, it } from 'vitest';
import { PUSH_MAX_MUTATIONS, type Vehicle } from '@car-record/shared';
import { META_CURSOR, META_LAST_SYNC_AT } from '../../db/db';
import { importRecords, saveRecord, savePhoto } from '../../db/repository';
import { fuelDraft, testBlob, vehicleDraft } from '../../db/__tests__/fixtures';
import { backoffDelay, createSyncEngine } from '../engine';
import { makeHarness, recorder, type Harness } from './helpers';

const harnesses: Harness[] = [];
function setup(...args: Parameters<typeof makeHarness>): Harness {
  const h = makeHarness(...args);
  harnesses.push(h);
  return h;
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.dispose()));
});

const vehicleRecord = (id: string, name = 'Remote'): Vehicle => ({
  id,
  createdAt: 1,
  updatedAt: 1,
  name,
  fuelType: 'gasoline',
});

describe('push → pull roundtrip', () => {
  it('pushes the outbox, writes rev back, pulls, saves cursor + lastSyncAt', async () => {
    const { db, server, engine, clock } = setup();
    const v = await saveRecord(db, 'vehicles', vehicleDraft({ name: 'Mine' }), 1);
    clock.now = 5_000;

    const status = await engine.syncNow();

    expect(server.get('vehicles', v.id)).toMatchObject({ name: 'Mine', rev: 1 });
    expect(await db.outbox.count()).toBe(0);
    expect((await db.vehicles.get(v.id))?.rev).toBe(1);
    expect(status).toMatchObject({ state: 'idle', pending: 0, failed: 0, lastSyncAt: 5_000 });
    expect(status.lastError).toBeUndefined();
    expect((await db.meta.get(META_CURSOR))?.value).toBe(1);
    expect((await db.meta.get(META_LAST_SYNC_AT))?.value).toBe(5_000);
    expect(engine.getStatus()).toEqual(status);
    // push happens before pull
    expect(server.requests.map((r) => r.path)).toEqual(['/api/sync/push', '/api/sync/pull']);
  });

  it('sends mutations in the protocol shape (no rev, no outbox bookkeeping)', async () => {
    const { db, server, engine } = setup();
    const v = await saveRecord(db, 'vehicles', vehicleDraft(), 1);
    const [entry] = await db.outbox.toArray();
    await engine.syncNow();
    const [push] = server.requestsTo('/api/sync/push');
    expect(push!.headers['content-type']).toMatch(/application\/json/);
    expect(push!.body).toEqual({ mutations: [{ mutationId: entry!.mutationId, table: 'vehicles', record: v }] });
  });

  it('pulls records created elsewhere into the cache', async () => {
    const { db, server, engine } = setup();
    server.seed('vehicles', vehicleRecord('remote-1'));
    server.seed('fuel', { ...fuelDraft('remote-1'), id: 'f1', createdAt: 1, updatedAt: 1 } as never);
    await engine.syncNow();
    expect(await db.vehicles.get('remote-1')).toMatchObject({ name: 'Remote', rev: 1 });
    expect(await db.fuel.get('f1')).toMatchObject({ vehicleId: 'remote-1', rev: 2 });
    // nothing to push → no push request
    expect(server.requestsTo('/api/sync/push')).toHaveLength(0);
  });

  it('first sync (no cursor) pulls from since=0 with the configured limit', async () => {
    const { server, engine } = setup({ pullLimit: 123 });
    await engine.syncNow();
    expect(server.requestsTo('/api/sync/pull')[0]!.query).toEqual({ since: '0', limit: '123' });
  });

  it('uses baseUrl', async () => {
    const { server, engine } = setup({ baseUrl: 'https://cars.example.test' });
    const urls: string[] = [];
    const engine2 = createSyncEngine({
      db: harnesses[0]!.db,
      baseUrl: 'https://cars.example.test',
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        urls.push(String(input));
        return server.fetch(input, init);
      }) as typeof fetch,
      online: () => true,
    });
    await engine2.syncNow();
    expect(urls).toEqual(['https://cars.example.test/api/sync/pull?since=0&limit=500']);
    void engine;
  });
});

describe('offline queueing', () => {
  it('queues writes while offline and pushes them once online', async () => {
    const { db, server, engine, net } = setup();
    net.online = false;
    const a = await saveRecord(db, 'vehicles', vehicleDraft({ name: 'A' }), 1);
    const b = await saveRecord(db, 'vehicles', vehicleDraft({ name: 'B' }), 2);

    const offline = await engine.syncNow();
    expect(offline).toMatchObject({ state: 'offline', pending: 2, failed: 0 });
    expect(server.requests).toHaveLength(0);

    net.online = true;
    const online = await engine.syncNow();
    expect(online).toMatchObject({ state: 'idle', pending: 0 });
    expect(server.get('vehicles', a.id)).toBeDefined();
    expect(server.get('vehicles', b.id)).toBeDefined();
  });

  it('pushes several offline edits of one record in order; last edit wins on the server', async () => {
    const { db, server, engine, net } = setup();
    net.online = false;
    const v = await saveRecord(db, 'vehicles', vehicleDraft({ name: 'v1' }), 1);
    await saveRecord(db, 'vehicles', { ...v, name: 'v2' }, 2);
    await saveRecord(db, 'vehicles', { ...v, name: 'v3' }, 3);
    expect(engine.getStatus().pending).toBe(0); // not refreshed yet (no sync / not started)
    expect((await engine.syncNow()).pending).toBe(3);

    net.online = true;
    await engine.syncNow();
    expect(server.applied.map((m) => (m.record as Vehicle).name)).toEqual(['v1', 'v2', 'v3']);
    expect(server.get('vehicles', v.id)).toMatchObject({ name: 'v3', rev: 3 });
    expect(await db.vehicles.get(v.id)).toMatchObject({ name: 'v3', rev: 3 });
    expect(await db.outbox.count()).toBe(0);
  });

  it(`pushes in batches of at most ${PUSH_MAX_MUTATIONS}`, async () => {
    const { db, server, engine } = setup();
    const vehicles = Array.from({ length: PUSH_MAX_MUTATIONS + 1 }, (_, i) => vehicleRecord(`v-${i}`, `n${i}`));
    await importRecords(db, { vehicles });
    await engine.syncNow();
    const pushes = server.requestsTo('/api/sync/push');
    expect(pushes.map((p) => (p.body as { mutations: unknown[] }).mutations.length)).toEqual([PUSH_MAX_MUTATIONS, 1]);
    expect(server.applied.map((m) => m.record.id)).toEqual(vehicles.map((v) => v.id));
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('push results', () => {
  it('a lost response is retried and acknowledged as duplicate (idempotent)', async () => {
    const { db, server, engine } = setup();
    const v = await saveRecord(db, 'vehicles', vehicleDraft(), 1);
    server.dropResponses = 1; // server applies the push, client never hears back

    const first = await engine.syncNow();
    expect(first.state).toBe('offline');
    expect(await db.outbox.count()).toBe(1);

    const second = await engine.syncNow();
    expect(second).toMatchObject({ state: 'idle', pending: 0 });
    expect(server.applied).toHaveLength(1); // not applied twice
    expect(server.rev).toBe(1);
    expect((await db.vehicles.get(v.id))?.rev).toBe(1);
  });

  it("rejected → 'failed' with lastError, not retried until retryFailed()", async () => {
    const { db, server, engine } = setup();
    const v = await saveRecord(db, 'vehicles', vehicleDraft(), 1);
    server.rejectMutation = () => 'vehicle limit reached';

    const status = await engine.syncNow();
    expect(status).toMatchObject({ state: 'idle', pending: 0, failed: 1 });
    const [entry] = await db.outbox.toArray();
    expect(entry).toMatchObject({ status: 'failed', lastError: 'vehicle limit reached', attempts: 1 });

    await engine.syncNow();
    expect(server.requestsTo('/api/sync/push')).toHaveLength(1); // not retried automatically

    server.rejectMutation = null;
    const retried = await engine.retryFailed();
    expect(retried).toMatchObject({ state: 'idle', pending: 0, failed: 0 });
    expect(server.get('vehicles', v.id)).toBeDefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it('a schema-invalid mutation is rejected individually; the rest of the batch still applies', async () => {
    const { db, server, engine } = setup();
    const good = await saveRecord(db, 'vehicles', vehicleDraft({ name: 'good' }), 1);
    // Corrupt entry slipped into the outbox (e.g. older app version).
    await db.outbox.add({
      mutationId: 'bad-1',
      table: 'vehicles',
      recordId: 'bad',
      record: { id: 'bad' } as unknown as Vehicle,
      createdAt: 2,
      attempts: 0,
      status: 'pending',
    });
    const status = await engine.syncNow();
    expect(status).toMatchObject({ pending: 0, failed: 1 });
    expect(server.get('vehicles', good.id)).toBeDefined();
    const bad = await db.outbox.where('mutationId').equals('bad-1').first();
    expect(bad?.status).toBe('failed');
    expect(bad?.lastError).toBeTruthy();
  });

  it('a later outbox entry for the same record still gets pushed after an earlier one failed', async () => {
    const { db, server, engine } = setup();
    const v = await saveRecord(db, 'vehicles', vehicleDraft({ name: 'first' }), 1);
    server.rejectMutation = (m) => ((m.record as Vehicle).name === 'first' ? 'nope' : undefined);
    await saveRecord(db, 'vehicles', { ...v, name: 'second' }, 2);
    await engine.syncNow();
    expect(server.get('vehicles', v.id)).toMatchObject({ name: 'second' });
  });

  it('5xx → entry stays pending, attempts++, state error', async () => {
    const { db, server, engine } = setup();
    await saveRecord(db, 'vehicles', vehicleDraft(), 1);
    server.serverError = 503;
    const status = await engine.syncNow();
    expect(status.state).toBe('error');
    expect(status.lastError).toMatch(/503/);
    expect(status.pending).toBe(1);
    const [entry] = await db.outbox.toArray();
    expect(entry).toMatchObject({ status: 'pending', attempts: 1 });

    server.serverError = null;
    expect((await engine.syncNow()).state).toBe('idle');
    expect(await db.outbox.count()).toBe(0);
  });

  it("network error → state 'offline', entry stays pending, attempts++", async () => {
    const { db, server, engine } = setup();
    await saveRecord(db, 'vehicles', vehicleDraft(), 1);
    server.offline = true;
    const s1 = await engine.syncNow();
    expect(s1).toMatchObject({ state: 'offline', pending: 1 });
    await engine.syncNow();
    const [entry] = await db.outbox.toArray();
    expect(entry).toMatchObject({ status: 'pending', attempts: 2 });
  });

  it("401 → state 'error', lastError 'unauthorized', nothing lost", async () => {
    const { db, server, engine } = setup();
    await saveRecord(db, 'vehicles', vehicleDraft(), 1);
    server.token = 'secret';
    const status = await engine.syncNow();
    expect(status).toMatchObject({ state: 'error', lastError: 'unauthorized', pending: 1 });
    expect((await db.outbox.toArray())[0]?.status).toBe('pending');
  });

  it('sends Authorization: Bearer <token> when getToken returns one', async () => {
    let token: string | undefined = 'secret';
    const { db, server, engine } = setup({ getToken: () => token });
    server.token = 'secret';
    await saveRecord(db, 'vehicles', vehicleDraft(), 1);
    await savePhoto(db, testBlob(), 1);
    expect((await engine.syncNow()).state).toBe('idle');
    expect(server.requests.length).toBe(3);
    expect(server.requests.every((r) => r.headers['authorization'] === 'Bearer secret')).toBe(true);

    token = undefined;
    server.token = undefined;
    await engine.syncNow();
    expect(server.requests.at(-1)!.headers['authorization']).toBeUndefined();
  });

  it('never throws, even on a malformed server response', async () => {
    const { db, engine } = setup();
    const garbage = createSyncEngine({
      db,
      fetch: (async () => new Response('<html>proxy error</html>', { status: 200 })) as typeof fetch,
      online: () => true,
    });
    await saveRecord(db, 'vehicles', vehicleDraft(), 1);
    const status = await garbage.syncNow();
    expect(status.state).toBe('error');
    expect(status.lastError).toBeTruthy();
    expect((await db.outbox.toArray())[0]?.status).toBe('pending');
    void engine;
  });
});

describe('rev write-back', () => {
  it('sets rev on the cached record from push results even if the pull fails', async () => {
    const { db, server, engine } = setup();
    const v = await saveRecord(db, 'vehicles', vehicleDraft(), 1);
    const realFetch = server.fetch;
    const e2 = createSyncEngine({
      db,
      online: () => true,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('/pull') ? new Response('oops', { status: 500 }) : realFetch(input, init)) as typeof fetch,
    });
    await e2.syncNow();
    expect((await db.vehicles.get(v.id))?.rev).toBe(1);
    void engine;
  });

  it('does not set rev when a newer local edit of the record is still queued', async () => {
    const { db, server } = setup();
    const v = await saveRecord(db, 'vehicles', vehicleDraft({ name: 'v1' }), 1);
    const realFetch = server.fetch;
    let pushes = 0;
    // The user edits the record while the first push request is in flight; the second push
    // is held back (offline) so we can observe the state in between.
    const engine = createSyncEngine({
      db,
      online: () => true,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/push')) {
          pushes += 1;
          if (pushes > 1) throw new TypeError('Failed to fetch');
          const res = await realFetch(input, init);
          await saveRecord(db, 'vehicles', { ...v, name: 'v2-local' }, 2);
          return res;
        }
        return realFetch(input, init);
      }) as typeof fetch,
    });
    const status = await engine.syncNow();
    const cached = await db.vehicles.get(v.id);
    expect(cached?.name).toBe('v2-local');
    expect(cached?.rev).toBeUndefined();
    expect(status.pending).toBe(1);
    expect(server.applied).toHaveLength(1);
  });

  it('pushes entries queued during the run in the same run', async () => {
    const { db, server } = setup();
    const v = await saveRecord(db, 'vehicles', vehicleDraft({ name: 'v1' }), 1);
    const realFetch = server.fetch;
    let edited = false;
    const engine = createSyncEngine({
      db,
      online: () => true,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await realFetch(input, init);
        if (String(input).includes('/push') && !edited) {
          edited = true;
          await saveRecord(db, 'vehicles', { ...v, name: 'v2' }, 2);
        }
        return res;
      }) as typeof fetch,
    });
    const status = await engine.syncNow();
    expect(status.pending).toBe(0);
    expect(server.get('vehicles', v.id)).toMatchObject({ name: 'v2', rev: 2 });
    expect(await db.vehicles.get(v.id)).toMatchObject({ name: 'v2', rev: 2 });
  });
});

describe('pull', () => {
  it('does not overwrite a record that has a pending outbox entry (local wins until pushed)', async () => {
    const { db, server } = setup();
    const v = await saveRecord(db, 'vehicles', vehicleDraft({ name: 'base' }), 1);
    const realFetch = server.fetch;
    let editDuringPull = true;
    const engine = createSyncEngine({
      db,
      online: () => true,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/pull') && editDuringPull) {
          editDuringPull = false;
          // Another device changed it, and meanwhile the user edits it locally.
          server.seed('vehicles', { ...v, name: 'remote' });
          await saveRecord(db, 'vehicles', { ...v, name: 'local' }, 3);
        }
        return realFetch(input, init);
      }) as typeof fetch,
    });

    await engine.syncNow();
    expect((await db.vehicles.get(v.id))?.name).toBe('local');
    expect(await db.outbox.where('status').equals('pending').count()).toBe(1);

    // Next sync pushes the local edit: last writer (by server order) wins.
    await engine.syncNow();
    expect(server.get('vehicles', v.id)).toMatchObject({ name: 'local' });
    expect(await db.vehicles.get(v.id)).toMatchObject({ name: 'local', rev: server.rev });
  });

  it('overwrites the cache with remote changes otherwise', async () => {
    const { db, server, engine } = setup();
    const v = await saveRecord(db, 'vehicles', vehicleDraft({ name: 'base' }), 1);
    await engine.syncNow();
    server.seed('vehicles', { ...v, name: 'remote', updatedAt: 9 });
    await engine.syncNow();
    expect(await db.vehicles.get(v.id)).toMatchObject({ name: 'remote', rev: 2 });
  });

  it('loops through pages while hasMore', async () => {
    const { db, server, engine } = setup({ pullLimit: 2 });
    for (let i = 0; i < 5; i++) server.seed('vehicles', vehicleRecord(`r${i}`));
    await engine.syncNow();
    expect(server.requestsTo('/api/sync/pull').map((r) => r.query['since'])).toEqual(['0', '2', '4']);
    expect(await db.vehicles.count()).toBe(5);
    expect((await db.meta.get(META_CURSOR))?.value).toBe(5);
  });

  it('persists the cursor in meta and reuses it (also across engine instances)', async () => {
    const { db, server, engine } = setup();
    server.seed('vehicles', vehicleRecord('a'));
    server.seed('vehicles', vehicleRecord('b'));
    await engine.syncNow();
    expect((await db.meta.get(META_CURSOR))?.value).toBe(2);

    server.seed('vehicles', vehicleRecord('c'));
    const fresh = createSyncEngine({ db, fetch: server.fetch, online: () => true });
    await fresh.syncNow();
    const pulls = server.requestsTo('/api/sync/pull');
    expect(pulls.at(-1)!.query['since']).toBe('2');
    expect((await db.meta.get(META_CURSOR))?.value).toBe(3);
    expect(await db.vehicles.count()).toBe(3);
  });

  it('keeps soft-deleted records from the server in the cache with deletedAt', async () => {
    const { db, server, engine } = setup();
    server.seed('vehicles', { ...vehicleRecord('d'), deletedAt: 50 });
    await engine.syncNow();
    expect((await db.vehicles.get('d'))?.deletedAt).toBe(50);
  });
});

describe('photos', () => {
  it('uploads pending photos with their content type, then drops the blob', async () => {
    const { db, server, engine } = setup();
    const id = await savePhoto(db, testBlob('JPEGDATA', 'image/jpeg'), 1);
    const status = await engine.syncNow();
    expect(status).toMatchObject({ state: 'idle', pending: 0 });
    const [put] = server.requests.filter((r) => r.method === 'PUT');
    expect(put!.path).toBe(`/api/photos/${id}`);
    expect(put!.headers['content-type']).toBe('image/jpeg');
    expect(new TextDecoder().decode(server.photos.get(id)!.bytes)).toBe('JPEGDATA');
    const entry = await db.photos.get(id);
    expect(entry?.status).toBe('uploaded');
    expect(entry?.blob).toBeUndefined();
  });

  it('keeps the photo pending when the upload fails', async () => {
    const { db, server, engine } = setup();
    const id = await savePhoto(db, testBlob(), 1);
    server.serverError = 500;
    const status = await engine.syncNow();
    expect(status.pending).toBe(1);
    const entry = await db.photos.get(id);
    expect(entry?.status).toBe('pending');
    expect(entry?.blob).toBeDefined();
  });
});

describe('status', () => {
  it('pending counts outbox + photos; failed counts failed outbox entries', async () => {
    const { db, server, engine, net } = setup();
    net.online = false;
    await saveRecord(db, 'vehicles', vehicleDraft(), 1);
    await saveRecord(db, 'vehicles', vehicleDraft(), 2);
    await savePhoto(db, testBlob(), 3);
    expect(await engine.syncNow()).toMatchObject({ pending: 3, failed: 0, state: 'offline' });

    net.online = true;
    let n = 0;
    server.rejectMutation = () => (n++ === 0 ? 'bad' : undefined);
    expect(await engine.syncNow()).toMatchObject({ pending: 0, failed: 1, state: 'idle' });
  });

  it('subscribe: called immediately with the current status, then on every change', async () => {
    const { db, engine } = setup();
    await saveRecord(db, 'vehicles', vehicleDraft(), 1);
    const { statuses, unsubscribe } = recorder(engine);
    expect(statuses).toEqual([{ state: 'idle', pending: 0, failed: 0 }]);

    await engine.syncNow();
    const states = statuses.map((s) => s.state);
    expect(states).toContain('syncing');
    expect(states.at(-1)).toBe('idle');
    expect(statuses.at(-1)).toMatchObject({ pending: 0, lastSyncAt: 1_000_000 });

    unsubscribe();
    const count = statuses.length;
    await engine.syncNow();
    expect(statuses).toHaveLength(count);
  });

  it('getStatus returns a snapshot that callers cannot mutate', async () => {
    const { engine } = setup();
    const s = engine.getStatus();
    s.state = 'error';
    expect(engine.getStatus().state).toBe('idle');
  });

  it('recovers from offline/error to idle with lastError cleared', async () => {
    const { server, engine } = setup();
    server.serverError = 500;
    expect((await engine.syncNow()).lastError).toBeTruthy();
    server.serverError = null;
    const ok = await engine.syncNow();
    expect(ok.state).toBe('idle');
    expect(ok.lastError).toBeUndefined();
  });

  it('loads lastSyncAt from meta', async () => {
    const { db, engine, clock } = setup();
    clock.now = 42;
    await engine.syncNow();
    const fresh = createSyncEngine({ db, fetch: harnesses[0]!.server.fetch, online: () => false });
    expect((await fresh.syncNow()).lastSyncAt).toBe(42);
  });
});

describe('concurrency', () => {
  it('concurrent syncNow() calls share one run', async () => {
    const { db, server, engine } = setup();
    await saveRecord(db, 'vehicles', vehicleDraft(), 1);
    const p1 = engine.syncNow();
    const p2 = engine.syncNow();
    const [s1, s2] = await Promise.all([p1, p2]);
    expect(s1).toEqual(s2);
    expect(server.requestsTo('/api/sync/push')).toHaveLength(1);
    expect(server.requestsTo('/api/sync/pull')).toHaveLength(1);
    expect(server.applied).toHaveLength(1);

    // After it finishes, a new call starts a new run.
    await engine.syncNow();
    expect(server.requestsTo('/api/sync/pull')).toHaveLength(2);
  });

  it('retryFailed while a run is in flight still pushes the retried entries', async () => {
    const { db, server, engine } = setup();
    await saveRecord(db, 'vehicles', vehicleDraft(), 1);
    server.rejectMutation = () => 'nope';
    await engine.syncNow();
    server.rejectMutation = null;
    const inFlight = engine.syncNow();
    const retried = engine.retryFailed();
    await inFlight;
    expect(await retried).toMatchObject({ failed: 0, pending: 0 });
    expect(server.applied).toHaveLength(1);
  });
});

describe('backoffDelay', () => {
  it('is exponential from 1s and capped at 5 minutes', () => {
    expect([1, 2, 3, 4].map(backoffDelay)).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(backoffDelay(9)).toBe(256_000);
    expect(backoffDelay(10)).toBe(300_000);
    expect(backoffDelay(100)).toBe(300_000);
    expect(backoffDelay(0)).toBe(0);
  });
});
