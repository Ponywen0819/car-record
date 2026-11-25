import { describe, expect, it } from 'vitest';
import { MIGRATIONS, migrate } from '../store';
import { makeApp, testDatabase } from './helpers';

/**
 * Photos were removed: a receipt / work-order picture has no value on its own; the forms scan the
 * e-invoice QR codes instead. The photo API is gone and a migration drops the old photos table.
 */
describe('photos (removed)', () => {
  it('has no photo upload or download endpoint any more', async () => {
    const { app } = await makeApp();
    const put = await app.request('/api/photos/0190a1b2-c3d4-7e5f-8a9b-0123456789ab', {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(put.status).toBe(404);
    expect(await put.json()).toEqual({ error: 'Not found' });
    const get = await app.request('/api/photos/0190a1b2-c3d4-7e5f-8a9b-0123456789ab');
    expect(get.status).toBe(404);
  });

  it('createApp needs no data directory', async () => {
    const { app } = await makeApp();
    expect((await app.request('/healthz')).status).toBe(200);
  });

  it('a database created by v0.2.0 loses its photos table on upgrade, keeping the records', async () => {
    const testDb = await testDatabase();
    const db = await testDb.open();
    // Bring the schema to v0.2.0 (migration 1 only), with a photo row and a record.
    await db.query('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)');
    for (const statement of MIGRATIONS[0]!) await db.query(statement);
    await db.query('INSERT INTO schema_migrations (version, applied_at) VALUES (1, 0)');
    await db.query(`INSERT INTO photos (id, content_type, size, created_at, updated_at) VALUES ('p1', 'image/jpeg', 3, 0, 0)`);
    await db.query(`INSERT INTO records (table_name, id, data, rev, updated_at) VALUES ('vehicles', 'v1', '{"id":"v1"}', 1, 0)`);
    await db.query(`UPDATE meta SET value = 1 WHERE key = 'rev'`);

    await migrate(db);

    const { rows: tables } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'photos'`,
    );
    expect(tables).toEqual([]);
    const { rows: records } = await db.query<{ id: string }>('SELECT id FROM records');
    expect(records).toEqual([{ id: 'v1' }]);
    const { rows: versions } = await db.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
    expect(versions.map((v) => v.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(2);
    await db.close();
  });
});
