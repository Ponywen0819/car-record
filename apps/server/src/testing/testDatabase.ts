import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { createPgDatabase, type Database } from '../database';
import { pgliteDatabase } from './pglite';

/**
 * A throw-away Postgres schema for one test.
 *
 * - Default: an in-process PGlite instance shared by the test file; every test gets its own schema.
 * - With TEST_DATABASE_URL set (CI): a real Postgres server; every test gets its own schema and
 *   connects through node-postgres exactly like production does.
 */
export interface TestDatabase {
  kind: 'pglite' | 'postgres';
  schema: string;
  /** Open a new handle to this test's schema, like a freshly started server process would. */
  open(): Promise<Database>;
  /** Close every handle opened here and drop the schema. */
  dispose(): Promise<void>;
}

let sharedPglite: Promise<PGlite> | undefined;

function getPglite(): Promise<PGlite> {
  // int8 (oid 20) → JS number, same as the production node-postgres type parser.
  sharedPglite ??= PGlite.create({ parsers: { 20: Number } });
  return sharedPglite;
}

/** Close the per-file PGlite instance (call from afterAll). */
export async function closeSharedPglite(): Promise<void> {
  const p = sharedPglite;
  sharedPglite = undefined;
  if (p) await (await p).close();
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const schema = `t_${crypto.randomBytes(8).toString('hex')}`;
  const url = process.env.TEST_DATABASE_URL;
  const handles: Database[] = [];

  if (url) {
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    return {
      kind: 'postgres',
      schema,
      async open() {
        const db = createPgDatabase(url, { searchPath: schema });
        handles.push(db);
        return db;
      },
      async dispose() {
        for (const h of handles) await h.close();
        try {
          await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        } finally {
          await admin.end();
        }
      },
    };
  }

  const lite = await getPglite();
  await lite.exec(`CREATE SCHEMA "${schema}"`);
  return {
    kind: 'pglite',
    schema,
    async open() {
      // PGlite is a single connection and tests in a file run one at a time.
      await lite.exec(`SET search_path TO "${schema}"`);
      const db = pgliteDatabase(lite);
      handles.push(db);
      return db;
    },
    async dispose() {
      for (const h of handles) await h.close();
      await lite.exec(`DROP SCHEMA "${schema}" CASCADE; SET search_path TO public`);
    },
  };
}
