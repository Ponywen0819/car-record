import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, type CarDB } from '../db';

/**
 * Photos were removed from the app. A phone that ran v0.2.0 has an IndexedDB with a `photos`
 * store (compressed receipt pictures waiting for upload); opening it with the new schema must
 * drop that store and keep every record and the outbox.
 */

const opened: Dexie[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await db.delete();
  }
});

let n = 0;
const name = () => `test-db-${Date.now()}-${n++}`;

describe('CarDB schema', () => {
  it('has no photos table', () => {
    const db = createDb(name());
    opened.push(db);
    expect(db.tables.map((t) => t.name)).not.toContain('photos');
    expect(db.tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['vehicles', 'maintenance', 'fuel', 'expenses', 'reminderRules', 'deadlines', 'outbox', 'meta']),
    );
  });

  it('upgrades a v0.2.0 database: drops photos, keeps records and the outbox', async () => {
    const dbName = name();
    // The v0.2.0 schema (CarDB version 1).
    const old = new Dexie(dbName);
    old.version(1).stores({
      vehicles: 'id',
      maintenance: 'id, vehicleId, date',
      fuel: 'id, vehicleId, date',
      expenses: 'id, vehicleId, date',
      reminderRules: 'id, vehicleId',
      deadlines: 'id, vehicleId, dueDate',
      outbox: '++seq, &mutationId, recordId, status',
      photos: 'id, status',
      meta: 'key',
    });
    await old.open();
    await old.table('vehicles').put({ id: 'v1', name: '小白', fuelType: 'gasoline', createdAt: 1, updatedAt: 1 });
    await old.table('outbox').put({ mutationId: 'm1', table: 'vehicles', recordId: 'v1', record: {}, createdAt: 1, attempts: 0, status: 'pending' });
    await old.table('photos').put({ id: 'p1', blob: new Blob(['x']), contentType: 'image/jpeg', status: 'pending', createdAt: 1 });
    old.close();

    const db: CarDB = createDb(dbName);
    opened.push(db);
    await db.open();
    expect(db.tables.map((t) => t.name)).not.toContain('photos');
    expect(Array.from(db.backendDB().objectStoreNames)).not.toContain('photos');
    expect((await db.vehicles.get('v1'))?.name).toBe('小白');
    expect(await db.outbox.count()).toBe(1);
  });
});
