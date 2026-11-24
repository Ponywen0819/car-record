import type { Change, Mutation, TableName } from '@car-record/shared';
import type { Database, Queryable } from './database';

/**
 * Postgres storage for the sync protocol.
 *
 * Model: one generic `records` table keyed by (table_name, id) holding the full record as JSONB.
 * Every applied mutation takes the next value of a single global, monotonically increasing
 * `rev` counter (the `meta` row 'rev'). The counter row is locked (SELECT … FOR UPDATE) for the
 * whole push transaction, so concurrent pushes are serialised: revs are gap-free, each batch is
 * contiguous, and a rev only becomes visible to pull once every lower rev is committed —
 * which is what lets clients use the last seen rev as their cursor.
 * (A SEQUENCE would not guarantee that last property.)
 */

/** Ordered list of migrations; each is a list of single statements. Never edit a shipped one. */
export const MIGRATIONS: readonly (readonly string[])[] = [
  [
    `CREATE TABLE meta (
       key   TEXT PRIMARY KEY,
       value BIGINT NOT NULL
     )`,
    `INSERT INTO meta (key, value) VALUES ('rev', 0)`,
    `CREATE TABLE records (
       table_name TEXT   NOT NULL,
       id         TEXT   NOT NULL,
       data       JSONB  NOT NULL,
       rev        BIGINT NOT NULL,
       deleted_at BIGINT,
       updated_at BIGINT NOT NULL,
       PRIMARY KEY (table_name, id)
     )`,
    `CREATE UNIQUE INDEX records_rev ON records (rev)`,
    `CREATE TABLE applied_mutations (
       mutation_id TEXT PRIMARY KEY,
       table_name  TEXT   NOT NULL,
       record_id   TEXT   NOT NULL,
       rev         BIGINT NOT NULL,
       applied_at  BIGINT NOT NULL
     )`,
    `CREATE TABLE record_history (
       table_name  TEXT   NOT NULL,
       id          TEXT   NOT NULL,
       data        JSONB  NOT NULL,
       rev         BIGINT NOT NULL,
       replaced_at BIGINT NOT NULL
     )`,
    `CREATE INDEX record_history_record ON record_history (table_name, id)`,
    `CREATE TABLE photos (
       id           TEXT PRIMARY KEY,
       content_type TEXT    NOT NULL,
       size         INTEGER NOT NULL,
       created_at   BIGINT  NOT NULL,
       updated_at   BIGINT  NOT NULL
     )`,
  ],
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

/**
 * Bring the current schema (search_path) up to date. Safe when several server processes start
 * at once: everything runs in one transaction behind a per-schema advisory lock.
 */
export async function migrate(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()))');
    await tx.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    INTEGER PRIMARY KEY,
         applied_at BIGINT NOT NULL
       )`,
    );
    const { rows } = await tx.query<{ v: number | null }>('SELECT max(version) AS v FROM schema_migrations');
    for (let v = rows[0]?.v ?? 0; v < MIGRATIONS.length; v++) {
      for (const statement of MIGRATIONS[v]!) await tx.query(statement);
      await tx.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [v + 1, Date.now()]);
    }
  });
}

export class Store {
  private constructor(
    readonly db: Database,
    private readonly now: () => number,
  ) {}

  /** Run migrations, then return a ready store. */
  static async open(db: Database, now: () => number = Date.now): Promise<Store> {
    await migrate(db);
    return new Store(db, now);
  }

  /** Cheap liveness check for /healthz. */
  async ping(): Promise<void> {
    await this.db.query('SELECT 1');
  }

  /**
   * Apply already-validated mutations in ONE transaction, in order.
   * Already-seen mutationIds (including repeats inside the same batch) are reported as duplicates.
   */
  async applyMutations(mutations: readonly Mutation[]): Promise<ApplyResult[]> {
    if (mutations.length === 0) return [];
    return this.db.transaction(async (tx: Queryable) => {
      const now = this.now();
      const { rows } = await tx.query<{ value: number }>("SELECT value FROM meta WHERE key = 'rev' FOR UPDATE");
      let rev = rows[0]!.value;
      const results: ApplyResult[] = [];
      for (const m of mutations) {
        const seen = await tx.query<{ rev: number }>('SELECT rev FROM applied_mutations WHERE mutation_id = $1', [
          m.mutationId,
        ]);
        if (seen.rows[0]) {
          results.push({ status: 'duplicate', rev: seen.rows[0].rev });
          continue;
        }
        rev++;
        const record = m.record;
        await tx.query(
          `INSERT INTO record_history (table_name, id, data, rev, replaced_at)
           SELECT table_name, id, data, rev, $3 FROM records WHERE table_name = $1 AND id = $2`,
          [m.table, record.id, now],
        );
        await tx.query(
          `INSERT INTO records (table_name, id, data, rev, deleted_at, updated_at)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6)
           ON CONFLICT (table_name, id) DO UPDATE SET
             data = excluded.data, rev = excluded.rev,
             deleted_at = excluded.deleted_at, updated_at = excluded.updated_at`,
          [m.table, record.id, JSON.stringify({ ...record, rev }), rev, record.deletedAt ?? null, record.updatedAt],
        );
        await tx.query(
          'INSERT INTO applied_mutations (mutation_id, table_name, record_id, rev, applied_at) VALUES ($1, $2, $3, $4, $5)',
          [m.mutationId, m.table, record.id, rev, now],
        );
        results.push({ status: 'applied', rev });
      }
      await tx.query("UPDATE meta SET value = $1 WHERE key = 'rev'", [rev]);
      return results;
    });
  }

  async pull(since: number, limit: number): Promise<PullPage> {
    const { rows } = await this.db.query<{ table_name: TableName; data: Change['record']; rev: number }>(
      'SELECT table_name, data, rev FROM records WHERE rev > $1 ORDER BY rev ASC LIMIT $2',
      [since, limit + 1],
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const changes = page.map((r) => ({ table: r.table_name, record: r.data }) as Change);
    const cursor = page.length ? page[page.length - 1]!.rev : since;
    return { changes, cursor, hasMore };
  }

  /** Previous versions of a record (oldest first) — the LWW audit trail. */
  async history(table: TableName, id: string): Promise<HistoryEntry[]> {
    const { rows } = await this.db.query<{ data: Record<string, unknown>; rev: number; replaced_at: number }>(
      'SELECT data, rev, replaced_at FROM record_history WHERE table_name = $1 AND id = $2 ORDER BY rev ASC',
      [table, id],
    );
    return rows.map((r) => ({ rev: r.rev, data: r.data, replacedAt: r.replaced_at }));
  }

  async getPhoto(id: string): Promise<PhotoMeta | undefined> {
    const { rows } = await this.db.query<{ id: string; content_type: string; size: number }>(
      'SELECT id, content_type, size FROM photos WHERE id = $1',
      [id],
    );
    const row = rows[0];
    return row && { id: row.id, contentType: row.content_type, size: row.size };
  }

  /** Upsert photo metadata; returns true if the photo is new. */
  async savePhoto(id: string, contentType: string, size: number): Promise<boolean> {
    const now = this.now();
    const { rows } = await this.db.query<{ inserted: boolean }>(
      `INSERT INTO photos (id, content_type, size, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (id) DO UPDATE SET
         content_type = excluded.content_type, size = excluded.size, updated_at = excluded.updated_at
       RETURNING (xmax = 0) AS inserted`,
      [id, contentType, size, now],
    );
    return rows[0]!.inserted;
  }

  close(): Promise<void> {
    return this.db.close();
  }
}
