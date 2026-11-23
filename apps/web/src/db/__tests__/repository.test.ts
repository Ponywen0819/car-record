import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { CarDB } from '../db';
import {
  getRecord,
  importRecords,
  listActive,
  localWrites,
  photoUrl,
  restoreRecord,
  saveRecord,
  savePhoto,
  softDelete,
} from '../repository';
import {
  disposeDb,
  expenseDraft,
  fuelDraft,
  makeTestDb,
  reminderDraft,
  testBlob,
  vehicleDraft,
} from './fixtures';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let db: CarDB;

beforeEach(() => {
  db = makeTestDb();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await disposeDb(db);
});

describe('saveRecord', () => {
  it('creates a record with a uuidv7 id, createdAt and updatedAt', async () => {
    const saved = await saveRecord(db, 'vehicles', vehicleDraft(), 1_000);
    expect(saved.id).toMatch(UUID_V7);
    expect(saved.createdAt).toBe(1_000);
    expect(saved.updatedAt).toBe(1_000);
    expect(saved.name).toBe('My Car');
    expect(await db.vehicles.get(saved.id)).toEqual(saved);
  });

  it('defaults now to Date.now()', async () => {
    const before = Date.now();
    const saved = await saveRecord(db, 'vehicles', vehicleDraft());
    expect(saved.createdAt).toBeGreaterThanOrEqual(before);
    expect(saved.updatedAt).toBe(saved.createdAt);
  });

  it('keeps a provided id and createdAt, but bumps updatedAt', async () => {
    const created = await saveRecord(db, 'vehicles', vehicleDraft(), 1_000);
    const updated = await saveRecord(db, 'vehicles', { ...created, name: 'Renamed' }, 2_000);
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(1_000);
    expect(updated.updatedAt).toBe(2_000);
    expect((await db.vehicles.get(created.id))?.name).toBe('Renamed');
    expect(await db.vehicles.count()).toBe(1);
  });

  it('writes cache and outbox together; the outbox entry is pending and carries no rev', async () => {
    const saved = await saveRecord(db, 'vehicles', vehicleDraft(), 1_000);
    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    const [entry] = outbox;
    expect(entry).toMatchObject({
      table: 'vehicles',
      recordId: saved.id,
      createdAt: 1_000,
      attempts: 0,
      status: 'pending',
    });
    expect(entry!.mutationId).toMatch(UUID_V7);
    expect(entry!.seq).toBeTypeOf('number');
    expect(entry!.record).toEqual(saved);
    expect('rev' in entry!.record).toBe(false);
  });

  it('appends one outbox entry per save, in order, each with a unique mutationId', async () => {
    const v = await saveRecord(db, 'vehicles', vehicleDraft(), 1_000);
    await saveRecord(db, 'vehicles', { ...v, name: 'B' }, 2_000);
    await saveRecord(db, 'vehicles', { ...v, name: 'C' }, 3_000);
    const outbox = await db.outbox.orderBy('seq').toArray();
    expect(outbox.map((e) => (e.record as { name: string }).name)).toEqual(['My Car', 'B', 'C']);
    expect(new Set(outbox.map((e) => e.mutationId)).size).toBe(3);
  });

  it('preserves the cached rev, but never sends rev in the outbox', async () => {
    const v = await saveRecord(db, 'vehicles', vehicleDraft(), 1_000);
    await db.vehicles.update(v.id, { rev: 42 });
    // Even if the UI passes a (stale) rev, the cache keeps its own rev.
    const updated = await saveRecord(db, 'vehicles', { ...v, rev: 7, name: 'X' } as typeof v, 2_000);
    expect(updated.rev).toBe(42);
    expect((await db.vehicles.get(v.id))?.rev).toBe(42);
    const last = await db.outbox.orderBy('seq').last();
    expect(last?.record).not.toHaveProperty('rev');
  });

  it('does not invent a rev for a never-synced record', async () => {
    const v = await saveRecord(db, 'vehicles', vehicleDraft(), 1_000);
    expect(v).not.toHaveProperty('rev');
    expect(await db.vehicles.get(v.id)).not.toHaveProperty('rev');
  });

  it('validates: an invalid record throws ZodError and nothing is written', async () => {
    const listener = vi.fn();
    localWrites.addEventListener('write', listener);
    try {
      await expect(
        saveRecord(db, 'fuel', fuelDraft('veh-1', { amount: -5 }), 1_000),
      ).rejects.toBeInstanceOf(ZodError);
      await expect(
        saveRecord(db, 'fuel', fuelDraft('veh-1', { date: '10/01/2026' }), 1_000),
      ).rejects.toBeInstanceOf(ZodError);
      // reminderRules has a cross-field refinement.
      await expect(
        saveRecord(db, 'reminderRules', reminderDraft('veh-1', { everyKm: undefined }), 1_000),
      ).rejects.toBeInstanceOf(ZodError);
    } finally {
      localWrites.removeEventListener('write', listener);
    }
    expect(await db.fuel.count()).toBe(0);
    expect(await db.reminderRules.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('strips unknown fields', async () => {
    const saved = await saveRecord(
      db,
      'vehicles',
      { ...vehicleDraft(), bogus: 1 } as unknown as ReturnType<typeof vehicleDraft>,
      1_000,
    );
    expect(saved).not.toHaveProperty('bogus');
  });

  it('is atomic: if the outbox write fails the cache is not written', async () => {
    // A duplicate mutationId violates the unique index on the outbox → the transaction aborts.
    const v = await saveRecord(db, 'vehicles', vehicleDraft(), 1_000);
    const existing = await db.outbox.toArray();
    const originalAdd = db.outbox.add.bind(db.outbox);
    const spy = vi.spyOn(db.outbox, 'add').mockImplementation((entry) =>
      originalAdd({ ...entry, mutationId: existing[0]!.mutationId }),
    );
    await expect(saveRecord(db, 'vehicles', { ...v, name: 'Never' }, 2_000)).rejects.toThrow();
    spy.mockRestore();
    expect((await db.vehicles.get(v.id))?.name).toBe('My Car');
    expect(await db.outbox.count()).toBe(1);
  });

  it("dispatches 'write' on localWrites after a successful save", async () => {
    const listener = vi.fn();
    localWrites.addEventListener('write', listener);
    try {
      await saveRecord(db, 'vehicles', vehicleDraft(), 1_000);
    } finally {
      localWrites.removeEventListener('write', listener);
    }
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]![0] as Event).type).toBe('write');
  });
});

describe('softDelete / restoreRecord', () => {
  it('softDelete sets deletedAt + updatedAt and queues the change', async () => {
    const v = await saveRecord(db, 'vehicles', vehicleDraft(), 1_000);
    const deleted = await softDelete(db, 'vehicles', v.id, 5_000);
    expect(deleted.deletedAt).toBe(5_000);
    expect(deleted.updatedAt).toBe(5_000);
    expect((await db.vehicles.get(v.id))?.deletedAt).toBe(5_000);
    const last = await db.outbox.orderBy('seq').last();
    expect(last?.record).toMatchObject({ id: v.id, deletedAt: 5_000 });
    expect(await db.outbox.count()).toBe(2);
  });

  it('restoreRecord removes deletedAt and queues the change', async () => {
    const v = await saveRecord(db, 'vehicles', vehicleDraft(), 1_000);
    await softDelete(db, 'vehicles', v.id, 5_000);
    const restored = await restoreRecord(db, 'vehicles', v.id, 6_000);
    expect(restored).not.toHaveProperty('deletedAt');
    expect(restored.updatedAt).toBe(6_000);
    expect(await db.vehicles.get(v.id)).not.toHaveProperty('deletedAt');
    const last = await db.outbox.orderBy('seq').last();
    expect(last?.record).not.toHaveProperty('deletedAt');
    expect(await db.outbox.count()).toBe(3);
  });

  it('preserves rev across delete / restore', async () => {
    const v = await saveRecord(db, 'vehicles', vehicleDraft(), 1_000);
    await db.vehicles.update(v.id, { rev: 9 });
    expect((await softDelete(db, 'vehicles', v.id, 2_000)).rev).toBe(9);
    expect((await restoreRecord(db, 'vehicles', v.id, 3_000)).rev).toBe(9);
  });

  it('throws when the record does not exist', async () => {
    await expect(softDelete(db, 'vehicles', 'nope', 1)).rejects.toThrow(/not found/i);
    await expect(restoreRecord(db, 'vehicles', 'nope', 1)).rejects.toThrow(/not found/i);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('getRecord / listActive', () => {
  it('getRecord returns the cached record (including soft-deleted) or undefined', async () => {
    const v = await saveRecord(db, 'vehicles', vehicleDraft(), 1_000);
    expect(await getRecord(db, 'vehicles', v.id)).toEqual(v);
    await softDelete(db, 'vehicles', v.id, 2_000);
    expect((await getRecord(db, 'vehicles', v.id))?.deletedAt).toBe(2_000);
    expect(await getRecord(db, 'vehicles', 'missing')).toBeUndefined();
  });

  it('excludes soft-deleted records', async () => {
    const a = await saveRecord(db, 'vehicles', vehicleDraft({ name: 'A' }), 1_000);
    await saveRecord(db, 'vehicles', vehicleDraft({ name: 'B' }), 2_000);
    await softDelete(db, 'vehicles', a.id, 3_000);
    expect((await listActive(db, 'vehicles')).map((v) => v.name)).toEqual(['B']);
  });

  it('sorts dated tables by date desc, then createdAt desc', async () => {
    await saveRecord(db, 'fuel', fuelDraft('v1', { date: '2026-01-01', note: 'old' }), 1_000);
    await saveRecord(db, 'fuel', fuelDraft('v1', { date: '2026-03-01', note: 'newest-first' }), 2_000);
    await saveRecord(db, 'fuel', fuelDraft('v1', { date: '2026-03-01', note: 'newest-second' }), 3_000);
    await saveRecord(db, 'fuel', fuelDraft('v1', { date: '2026-02-01', note: 'mid' }), 4_000);
    expect((await listActive(db, 'fuel')).map((r) => r.note)).toEqual([
      'newest-second',
      'newest-first',
      'mid',
      'old',
    ]);
  });

  it('sorts undated tables by createdAt asc', async () => {
    await saveRecord(db, 'vehicles', vehicleDraft({ name: 'second', createdAt: 2_000 }), 9_000);
    await saveRecord(db, 'vehicles', vehicleDraft({ name: 'first', createdAt: 1_000 }), 9_000);
    await saveRecord(db, 'vehicles', vehicleDraft({ name: 'third', createdAt: 3_000 }), 9_000);
    expect((await listActive(db, 'vehicles')).map((v) => v.name)).toEqual(['first', 'second', 'third']);
  });

  it('filters by vehicleId', async () => {
    await saveRecord(db, 'expenses', expenseDraft('v1', { note: 'a' }), 1_000);
    await saveRecord(db, 'expenses', expenseDraft('v2', { note: 'b' }), 2_000);
    await saveRecord(db, 'expenses', expenseDraft('v1', { note: 'c' }), 3_000);
    expect((await listActive(db, 'expenses', 'v1')).map((r) => r.note).sort()).toEqual(['a', 'c']);
    expect((await listActive(db, 'expenses', 'v2')).map((r) => r.note)).toEqual(['b']);
    expect(await listActive(db, 'expenses')).toHaveLength(3);
  });
});

describe('importRecords', () => {
  it('upserts every record through the outbox in one go and returns the count', async () => {
    const listener = vi.fn();
    localWrites.addEventListener('write', listener);
    let count: number;
    try {
      count = await importRecords(
        db,
        {
          vehicles: [{ id: 'veh-1', createdAt: 10, updatedAt: 20, name: 'Imported', fuelType: 'diesel', rev: 99 }],
          fuel: [
            { id: 'f-1', createdAt: 11, updatedAt: 21, vehicleId: 'veh-1', date: '2025-05-05', odometer: 100, amount: 10, isFull: true },
            { id: 'f-2', createdAt: 12, updatedAt: 22, vehicleId: 'veh-1', date: '2025-06-05', odometer: 200, amount: 10, isFull: false },
          ],
        },
        5_000,
      );
    } finally {
      localWrites.removeEventListener('write', listener);
    }
    expect(count).toBe(3);
    expect(await db.vehicles.get('veh-1')).toMatchObject({ name: 'Imported', createdAt: 10 });
    expect(await db.fuel.count()).toBe(2);
    const outbox = await db.outbox.orderBy('seq').toArray();
    expect(outbox.map((e) => e.recordId)).toEqual(['veh-1', 'f-1', 'f-2']);
    expect(outbox.every((e) => e.status === 'pending' && e.createdAt === 5_000)).toBe(true);
    // A rev from the snapshot is never sent to the server.
    expect(outbox[0]!.record).not.toHaveProperty('rev');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is all-or-nothing: one invalid record → throws and nothing is written', async () => {
    await expect(
      importRecords(db, {
        vehicles: [{ id: 'veh-1', createdAt: 1, updatedAt: 1, name: 'Ok', fuelType: 'ev' }],
        fuel: [
          { id: 'bad', createdAt: 1, updatedAt: 1, vehicleId: 'veh-1', date: 'nope', odometer: 1, amount: 1, isFull: true },
        ],
      }),
    ).rejects.toThrow();
    expect(await db.vehicles.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('returns 0 for an empty import', async () => {
    expect(await importRecords(db, {})).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('photos', () => {
  it('savePhoto stores the blob as pending and returns a uuidv7 id', async () => {
    const listener = vi.fn();
    localWrites.addEventListener('write', listener);
    let id: string;
    try {
      id = await savePhoto(db, testBlob('abc', 'image/webp'), 7_000);
    } finally {
      localWrites.removeEventListener('write', listener);
    }
    expect(id).toMatch(UUID_V7);
    const entry = await db.photos.get(id);
    expect(entry).toMatchObject({ id, contentType: 'image/webp', status: 'pending', createdAt: 7_000 });
    expect(await entry!.blob!.text()).toBe('abc');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('savePhoto falls back to application/octet-stream when the blob has no type', async () => {
    const id = await savePhoto(db, testBlob('abc', ''), 1);
    expect((await db.photos.get(id))?.contentType).toBe('application/octet-stream');
  });

  it('photoUrl returns an object URL while the blob is local', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    const id = await savePhoto(db, testBlob(), 1);
    expect(await photoUrl(db, id, 'https://example.test')).toBe('blob:fake-url');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('photoUrl returns the server URL once uploaded (blob dropped)', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    await db.photos.put({ id: 'p1', contentType: 'image/jpeg', status: 'uploaded', createdAt: 1 });
    expect(await photoUrl(db, 'p1', 'https://example.test')).toBe('https://example.test/api/photos/p1');
    expect(await photoUrl(db, 'p1')).toBe('/api/photos/p1');
    expect(create).not.toHaveBeenCalled();
  });

  it('photoUrl returns the server URL for photos unknown locally (e.g. synced from another device)', async () => {
    expect(await photoUrl(db, 'remote-photo', '')).toBe('/api/photos/remote-photo');
  });
});
