/**
 * Two devices (separate Dexie databases + engines) sharing one server.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRecord, listActive, restoreRecord, saveRecord, softDelete } from '../../db/repository';
import { fuelDraft, vehicleDraft } from '../../db/__tests__/fixtures';
import { createFakeServer, type FakeServer } from './fakeServer';
import { makeHarness, type Harness } from './helpers';

let server: FakeServer;
let A: Harness;
let B: Harness;

beforeEach(() => {
  server = createFakeServer();
  A = makeHarness({ server });
  B = makeHarness({ server });
});

afterEach(async () => {
  await A.dispose();
  await B.dispose();
});

describe('two devices, one server', () => {
  it('create on A → appears on B; edit on B → A sees it; soft delete on A → B sees it', async () => {
    // create on A
    const car = await saveRecord(A.db, 'vehicles', vehicleDraft({ name: 'Civic' }), 1);
    const fill = await saveRecord(A.db, 'fuel', fuelDraft(car.id, { odometer: 12_345 }), 2);
    await A.engine.syncNow();
    await B.engine.syncNow();
    expect(await getRecord(B.db, 'vehicles', car.id)).toMatchObject({ name: 'Civic', rev: 1 });
    expect(await listActive(B.db, 'fuel', car.id)).toEqual([{ ...fill, rev: 2 }]);

    // edit on B
    const onB = (await getRecord(B.db, 'vehicles', car.id))!;
    await saveRecord(B.db, 'vehicles', { ...onB, name: 'Civic Type R' }, 3);
    await B.engine.syncNow();
    await A.engine.syncNow();
    expect(await getRecord(A.db, 'vehicles', car.id)).toMatchObject({ name: 'Civic Type R', rev: 3 });

    // soft delete on A
    await softDelete(A.db, 'fuel', fill.id, 4);
    await A.engine.syncNow();
    await B.engine.syncNow();
    expect((await getRecord(B.db, 'fuel', fill.id))?.deletedAt).toBe(4);
    expect(await listActive(B.db, 'fuel', car.id)).toEqual([]);

    // restore on B → back on A
    await restoreRecord(B.db, 'fuel', fill.id, 5);
    await B.engine.syncNow();
    await A.engine.syncNow();
    expect(await listActive(A.db, 'fuel', car.id)).toHaveLength(1);

    // Both caches converge to the server state.
    for (const h of [A, B]) {
      expect(await h.db.outbox.count()).toBe(0);
      expect(await h.db.vehicles.get(car.id)).toEqual(server.get('vehicles', car.id));
      expect(await h.db.fuel.get(fill.id)).toEqual(server.get('fuel', fill.id));
    }
  });

  it('concurrent offline edits: last push (server order) wins on both devices', async () => {
    const car = await saveRecord(A.db, 'vehicles', vehicleDraft({ name: 'base' }), 1);
    await A.engine.syncNow();
    await B.engine.syncNow();

    A.net.online = false;
    B.net.online = false;
    await saveRecord(A.db, 'vehicles', { ...car, name: 'from A' }, 10);
    const onB = (await getRecord(B.db, 'vehicles', car.id))!;
    await saveRecord(B.db, 'vehicles', { ...onB, name: 'from B' }, 11);

    // B reconnects first, then A: A's push lands last and wins.
    B.net.online = true;
    await B.engine.syncNow();
    A.net.online = true;
    await A.engine.syncNow();
    await B.engine.syncNow();

    expect(server.get('vehicles', car.id)).toMatchObject({ name: 'from A' });
    expect((await getRecord(A.db, 'vehicles', car.id))?.name).toBe('from A');
    expect((await getRecord(B.db, 'vehicles', car.id))?.name).toBe('from A');
  });
});
