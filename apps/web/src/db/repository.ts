/**
 * Repository contract — the ONLY way the UI writes data.
 * Every write validates the record, updates the cache and appends to the outbox in a
 * single Dexie transaction, then dispatches a 'write' event on `localWrites` so the sync
 * engine can schedule a (debounced) sync.
 *
 * Owned by the sync workstream.
 */
import { recordSchemas, TABLES, uuidv7 } from '@car-record/shared';
import type { AnyRecord, TableName, TableRecordMap } from '@car-record/shared';
import type { CarDB, OutboxEntry } from './db';

/** Fires `new Event('write')` after every successful local write. */
export const localWrites: EventTarget = new EventTarget();

/** A record as the UI builds it: id / createdAt are optional (generated), sync fields are managed here. */
export type Draft<T extends TableName> = Omit<TableRecordMap[T], 'id' | 'createdAt' | 'updatedAt' | 'rev'> & {
  id?: string;
  createdAt?: number;
};

/** Tables whose records carry a `date` (sorted newest first in lists). */
const DATED_TABLES: ReadonlySet<TableName> = new Set<TableName>(['maintenance', 'fuel', 'expenses']);

function notifyWrite(): void {
  localWrites.dispatchEvent(new Event('write'));
}

/** Drop `rev` (server-managed) from a record-like object. */
function withoutRev<R extends object>(record: R): Omit<R, 'rev'> {
  const { rev: _rev, ...rest } = record as R & { rev?: unknown };
  return rest;
}

/**
 * Validate a full record (without rev) against its table schema. Throws ZodError.
 * Returns the parsed value (unknown keys stripped).
 */
function validate<T extends TableName>(table: T, record: object): TableRecordMap[T] {
  const schema = recordSchemas[table] as unknown as { parse(v: unknown): TableRecordMap[T] };
  return schema.parse(withoutRev(record));
}

function outboxEntry(table: TableName, record: AnyRecord, now: number): OutboxEntry {
  return {
    mutationId: uuidv7(now),
    table,
    recordId: record.id,
    record,
    createdAt: now,
    attempts: 0,
    status: 'pending',
  };
}

/** Cache copy = validated record + the cached server rev (if any). */
function cacheCopy<T extends TableName>(record: TableRecordMap[T], rev: number | undefined): TableRecordMap[T] {
  return rev === undefined ? record : { ...record, rev };
}

/**
 * Write an already-validated record (no rev) to the cache and the outbox atomically.
 * Must run inside a rw transaction over [table, outbox].
 */
async function writeInTx<T extends TableName>(
  db: CarDB,
  table: T,
  record: TableRecordMap[T],
  now: number,
): Promise<TableRecordMap[T]> {
  const t = db.tableFor(table);
  const cached = await t.get(record.id);
  const stored = cacheCopy(record, cached?.rev);
  await t.put(stored);
  await db.outbox.add(outboxEntry(table, record, now));
  return stored;
}

/**
 * Create or update. Generates id (uuidv7) and createdAt when missing, sets updatedAt = now,
 * strips `rev` from what goes into the outbox, validates against the table's zod schema
 * (throws ZodError → nothing written). Preserves the cached record's `rev`.
 */
export async function saveRecord<T extends TableName>(
  db: CarDB,
  table: T,
  draft: Draft<T>,
  now: number = Date.now(),
): Promise<TableRecordMap[T]> {
  const record = validate(table, {
    ...draft,
    id: draft.id ?? uuidv7(now),
    createdAt: draft.createdAt ?? now,
    updatedAt: now,
  });
  const stored = await db.transaction('rw', [db.tableFor(table), db.outbox], () =>
    writeInTx(db, table, record, now),
  );
  notifyWrite();
  return stored;
}

async function mutateExisting<T extends TableName>(
  db: CarDB,
  table: T,
  id: string,
  now: number,
  change: (record: TableRecordMap[T]) => object,
): Promise<TableRecordMap[T]> {
  const t = db.tableFor(table);
  const stored = await db.transaction('rw', [t, db.outbox], async () => {
    const cached = await t.get(id);
    if (!cached) throw new Error(`${table} record not found: ${id}`);
    const record = validate(table, { ...change(cached), updatedAt: now });
    return writeInTx(db, table, record, now);
  });
  notifyWrite();
  return stored;
}

/** Soft delete (sets deletedAt). Returns the updated record. Throws if not found. */
export async function softDelete<T extends TableName>(
  db: CarDB,
  table: T,
  id: string,
  now: number = Date.now(),
): Promise<TableRecordMap[T]> {
  return mutateExisting(db, table, id, now, (r) => ({ ...r, deletedAt: now }));
}

/** Undo a soft delete (removes deletedAt). Throws if not found. */
export async function restoreRecord<T extends TableName>(
  db: CarDB,
  table: T,
  id: string,
  now: number = Date.now(),
): Promise<TableRecordMap[T]> {
  return mutateExisting(db, table, id, now, (r) => {
    const { deletedAt: _deletedAt, ...rest } = r as TableRecordMap[T] & { deletedAt?: number };
    return rest;
  });
}

export async function getRecord<T extends TableName>(
  db: CarDB,
  table: T,
  id: string,
): Promise<TableRecordMap[T] | undefined> {
  return db.tableFor(table).get(id);
}

/**
 * Non-deleted records, optionally for one vehicle. Tables with `date` are sorted by
 * date desc then createdAt desc; others by createdAt asc.
 */
export async function listActive<T extends TableName>(
  db: CarDB,
  table: T,
  vehicleId?: string,
): Promise<TableRecordMap[T][]> {
  const t = db.tableFor(table);
  // `vehicles` has no vehicleId index/field, so the filter only applies to vehicle-scoped tables.
  const scoped = vehicleId !== undefined && table !== 'vehicles';
  const rows = scoped ? await t.where('vehicleId').equals(vehicleId).toArray() : await t.toArray();
  const active = rows.filter((r) => r.deletedAt === undefined || r.deletedAt === null);
  if (DATED_TABLES.has(table)) {
    type Dated = { date: string; createdAt: number };
    return active.sort((a, b) => {
      const x = a as unknown as Dated;
      const y = b as unknown as Dated;
      if (x.date !== y.date) return x.date < y.date ? 1 : -1;
      return y.createdAt - x.createdAt;
    });
  }
  return active.sort((a, b) => a.createdAt - b.createdAt);
}

/** Bulk import (e.g. from a JSON snapshot): upserts every record through the outbox in one transaction. */
export async function importRecords(
  db: CarDB,
  tables: Partial<{ [T in TableName]: TableRecordMap[T][] }>,
  now: number = Date.now(),
): Promise<number> {
  // Validate everything up front so an invalid record aborts before any write.
  const items: { table: TableName; record: AnyRecord }[] = [];
  for (const table of TABLES) {
    for (const raw of tables[table] ?? []) {
      items.push({ table, record: validate(table, raw) });
    }
  }
  if (items.length === 0) return 0;

  const touched = [...new Set(items.map((i) => i.table))].map((t) => db.tableFor(t));
  await db.transaction('rw', [...touched, db.outbox], async () => {
    for (const { table, record } of items) {
      await writeInTx(db, table, record as TableRecordMap[typeof table], now);
    }
  });
  notifyWrite();
  return items.length;
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/** Store a (already compressed) photo locally as pending upload. Returns its id (uuidv7). */
export async function savePhoto(db: CarDB, blob: Blob, now: number = Date.now()): Promise<string> {
  const id = uuidv7(now);
  await db.photos.put({
    id,
    blob,
    contentType: blob.type || 'application/octet-stream',
    status: 'pending',
    createdAt: now,
  });
  notifyWrite();
  return id;
}

/**
 * URL to display a photo: an object URL for a local blob, otherwise `${baseUrl}/api/photos/${id}`.
 * Callers revoke object URLs (blob: prefix) when done.
 */
export async function photoUrl(db: CarDB, id: string, baseUrl = ''): Promise<string> {
  const entry = await db.photos.get(id);
  if (entry?.blob) return URL.createObjectURL(entry.blob);
  return `${baseUrl}/api/photos/${encodeURIComponent(id)}`;
}
