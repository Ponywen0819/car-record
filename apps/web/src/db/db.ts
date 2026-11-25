/**
 * Client-side IndexedDB (Dexie). This is a CACHE of server data plus an OUTBOX of
 * not-yet-pushed changes — the server is the source of truth (SPEC.md §4.5).
 *
 * Soft-deleted records stay in the cache (with deletedAt) so they can be restored and
 * so pulls stay consistent; UI queries must filter them out.
 */
import Dexie, { type Table } from 'dexie';
import type {
  AnyRecord,
  Deadline,
  ExpenseRecord,
  FuelRecord,
  MaintenanceRecord,
  ReminderRule,
  TableName,
  Vehicle,
} from '@car-record/shared';

export interface OutboxEntry {
  /** Auto-increment; push order. */
  seq?: number;
  mutationId: string;
  table: TableName;
  recordId: string;
  record: AnyRecord;
  createdAt: number;
  attempts: number;
  /** 'failed' = server rejected it (4xx); kept for the user to inspect / retry. */
  status: 'pending' | 'failed';
  lastError?: string;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export class CarDB extends Dexie {
  vehicles!: Table<Vehicle, string>;
  maintenance!: Table<MaintenanceRecord, string>;
  fuel!: Table<FuelRecord, string>;
  expenses!: Table<ExpenseRecord, string>;
  reminderRules!: Table<ReminderRule, string>;
  deadlines!: Table<Deadline, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;

  constructor(name = 'car-record') {
    super(name);
    this.version(1).stores({
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
    this.version(2).stores({
      photos: null,
    });
  }

  /** Typed access to a record table by name. */
  tableFor<T extends TableName>(table: T): Table<import('@car-record/shared').TableRecordMap[T], string> {
    return this.table(table);
  }
}

/** Meta keys used by the sync engine. */
export const META_CURSOR = 'cursor';
export const META_LAST_SYNC_AT = 'lastSyncAt';

export function createDb(name?: string): CarDB {
  return new CarDB(name);
}
