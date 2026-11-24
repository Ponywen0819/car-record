import pg from 'pg';

/** Minimal query surface shared by node-postgres (production) and PGlite (tests). */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface Database extends Queryable {
  /** Run `fn` inside BEGIN … COMMIT on one connection; ROLLBACK if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Release all connections. Safe to call more than once. */
  close(): Promise<void>;
}

const INT8_OID = 20;

/**
 * int8/bigint columns (revs, epoch-ms timestamps) come back as JS numbers instead of strings.
 * Every value we store is far below Number.MAX_SAFE_INTEGER.
 */
const types = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    oid === INT8_OID ? (v: string) => Number(v) : pg.types.getTypeParser(oid, format)) as typeof pg.types.getTypeParser,
};

export interface PgDatabaseOptions {
  /** Run `SET search_path TO <schema>` on every new connection (tests use one schema per test). */
  searchPath?: string;
}

/** Production database: a node-postgres pool. */
export function createPgDatabase(config: string | pg.PoolConfig, opts: PgDatabaseOptions = {}): Database {
  const pool = new pg.Pool({
    max: 10,
    ...(typeof config === 'string' ? { connectionString: config } : config),
    types,
  });
  // An idle client losing its connection (Postgres restart) must not crash the process;
  // the next query simply gets a new connection.
  pool.on('error', (err) => console.error('postgres pool error:', err.message));
  if (opts.searchPath) {
    const ident = `"${opts.searchPath.replaceAll('"', '""')}"`;
    // node-postgres queues queries per client, so this runs before anything the pool hands out.
    pool.on('connect', (client) => void client.query(`SET search_path TO ${ident}`).catch(() => {}));
  }

  let closed: Promise<void> | undefined;
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const res = await pool.query(sql, params as unknown[]);
      return { rows: res.rows as T[] };
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          async query<T>(sql: string, params: readonly unknown[] = []) {
            const res = await client.query(sql, params as unknown[]);
            return { rows: res.rows as T[] };
          },
        });
        await client.query('COMMIT');
        client.release();
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
          client.release();
        } catch {
          client.release(true); // connection is broken: discard it
        }
        throw err;
      }
    },
    close() {
      closed ??= pool.end();
      return closed;
    },
  };
}
