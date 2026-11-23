import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Change, Mutation, TableName } from '@car-record/shared';

/**
 * SQLite storage (node:sqlite) for the sync protocol.
 *
 * Model: one generic `records` table keyed by (table_name, id) holding the full record JSON.
 * Every applied mutation takes the next value of a single global, monotonically increasing
 * `rev` counter (stored in `meta`). The server-assigned rev is written into the record JSON
 * (overriding anything the client sent) so pull can return records as-is.
 */

/** Ordered list of migrations; index + 1 === resulting PRAGMA user_version. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
  INSERT INTO meta (key, value) VALUES ('rev', 0);

  CREATE TABLE records (
    table_name TEXT    NOT NULL,
    id         TEXT    NOT NULL,
    data       TEXT    NOT NULL,
    rev        INTEGER NOT NULL,
    deleted_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (table_name, id)
  );
  CREATE UNIQUE INDEX records_rev ON records (rev);

  CREATE TABLE applied_mutations (
    mutation_id TEXT PRIMARY KEY,
    table_name  TEXT    NOT NULL,
    record_id   TEXT    NOT NULL,
    rev         INTEGER NOT NULL,
    applied_at  INTEGER NOT NULL
  );

  CREATE TABLE record_history (
    table_name  TEXT    NOT NULL,
    id          TEXT    NOT NULL,
    data        TEXT    NOT NULL,
    rev         INTEGER NOT NULL,
    replaced_at INTEGER NOT NULL
  );
  CREATE INDEX record_history_record ON record_history (table_name, id);

  CREATE TABLE photos (
    id           TEXT PRIMARY KEY,
    content_type TEXT    NOT NULL,
    size         INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  `,
];

export type ApplyResult = { status: 'applied' | 'duplicate'; rev: number };

export interface HistoryEntry {
  rev: number;
  data: Record<string, unknown>;
  replacedAt: number;
}

export interface PhotoMeta {
  id: string;
  contentType: string;
  size: number;
}

export interface PullPage {
  changes: Change[];
  cursor: number;
  hasMore: boolean;
}

export class Store {
  readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(dataDir: string, now: () => number = Date.now) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.now = now;
    // Loaded lazily (not a static import) so main.ts can filter node:sqlite's ExperimentalWarning first.
    const { DatabaseSync: Database } = process.getBuiltinModule('node:sqlite');
    this.db = new Database(path.join(dataDir, 'app.db'));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let v = row.user_version; v < MIGRATIONS.length; v++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Apply already-validated mutations in ONE transaction, in order.
   * Already-seen mutationIds (including repeats inside the same batch) are reported as duplicates.
   */
  applyMutations(mutations: readonly Mutation[]): ApplyResult[] {
    const findApplied = this.db.prepare('SELECT rev FROM applied_mutations WHERE mutation_id = ?');
    const getRev = this.db.prepare("SELECT value FROM meta WHERE key = 'rev'");
    const setRev = this.db.prepare("UPDATE meta SET value = ? WHERE key = 'rev'");
    const findRecord = this.db.prepare('SELECT data, rev FROM records WHERE table_name = ? AND id = ?');
    const insertHistory = this.db.prepare(
      'INSERT INTO record_history (table_name, id, data, rev, replaced_at) VALUES (?, ?, ?, ?, ?)',
    );
    const upsertRecord = this.db.prepare(`
      INSERT INTO records (table_name, id, data, rev, deleted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (table_name, id) DO UPDATE SET
        data = excluded.data, rev = excluded.rev, deleted_at = excluded.deleted_at, updated_at = excluded.updated_at
    `);
    const insertApplied = this.db.prepare(
      'INSERT INTO applied_mutations (mutation_id, table_name, record_id, rev, applied_at) VALUES (?, ?, ?, ?, ?)',
    );

    return this.transaction(() => {
      const now = this.now();
      let rev = (getRev.get() as { value: number }).value;
      const results: ApplyResult[] = [];
      for (const m of mutations) {
        const seen = findApplied.get(m.mutationId) as { rev: number } | undefined;
        if (seen) {
          results.push({ status: 'duplicate', rev: seen.rev });
          continue;
        }
        rev++;
        const record = m.record;
        const previous = findRecord.get(m.table, record.id) as { data: string; rev: number } | undefined;
        if (previous) insertHistory.run(m.table, record.id, previous.data, previous.rev, now);
        const data = JSON.stringify({ ...record, rev });
        upsertRecord.run(m.table, record.id, data, rev, record.deletedAt ?? null, record.updatedAt);
        insertApplied.run(m.mutationId, m.table, record.id, rev, now);
        results.push({ status: 'applied', rev });
      }
      setRev.run(rev);
      return results;
    });
  }

  pull(since: number, limit: number): PullPage {
    const rows = this.db
      .prepare('SELECT table_name, data, rev FROM records WHERE rev > ? ORDER BY rev ASC LIMIT ?')
      .all(since, limit + 1) as { table_name: TableName; data: string; rev: number }[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const changes = page.map((r) => ({ table: r.table_name, record: JSON.parse(r.data) }) as Change);
    const cursor = page.length ? page[page.length - 1]!.rev : since;
    return { changes, cursor, hasMore };
  }

  /** Previous versions of a record (oldest first) — the LWW audit trail. */
  history(table: TableName, id: string): HistoryEntry[] {
    const rows = this.db
      .prepare('SELECT data, rev, replaced_at FROM record_history WHERE table_name = ? AND id = ? ORDER BY rev ASC')
      .all(table, id) as { data: string; rev: number; replaced_at: number }[];
    return rows.map((r) => ({ rev: r.rev, data: JSON.parse(r.data), replacedAt: r.replaced_at }));
  }

  getPhoto(id: string): PhotoMeta | undefined {
    const row = this.db.prepare('SELECT id, content_type, size FROM photos WHERE id = ?').get(id) as
      | { id: string; content_type: string; size: number }
      | undefined;
    return row && { id: row.id, contentType: row.content_type, size: row.size };
  }

  /** Upsert photo metadata; returns true if the photo is new. */
  savePhoto(id: string, contentType: string, size: number): boolean {
    const now = this.now();
    return this.transaction(() => {
      const existed = this.db.prepare('SELECT 1 FROM photos WHERE id = ?').get(id) !== undefined;
      this.db
        .prepare(
          `INSERT INTO photos (id, content_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET content_type = excluded.content_type, size = excluded.size, updated_at = excluded.updated_at`,
        )
        .run(id, contentType, size, now, now);
      return !existed;
    });
  }

  journalMode(): string {
    return (this.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}
