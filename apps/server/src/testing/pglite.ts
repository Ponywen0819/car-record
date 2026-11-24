import type { PGlite, Transaction } from '@electric-sql/pglite';
import type { Database, Queryable } from '../database';

/**
 * Test-only adapter: PGlite (real Postgres compiled to WASM, in-process) behind the same
 * Database interface the server uses with node-postgres. Never imported by main.ts, so it is
 * not part of the production bundle.
 */
function wrap(q: PGlite | Transaction): Queryable {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const res = await q.query<T>(sql, params as unknown[]);
      return { rows: res.rows };
    },
  };
}

export function pgliteDatabase(pg: PGlite, onClose: () => Promise<void> = async () => {}): Database {
  let closed = false;
  return {
    ...wrap(pg),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
    async close() {
      if (closed) return;
      closed = true;
      await onClose();
    },
  };
}
