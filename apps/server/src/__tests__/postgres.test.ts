import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { Database } from '../database';
import { MIGRATIONS } from '../store';
import { makeApp, mutation, pull, push, testDatabase, vehicle } from './helpers';

/** A Database whose every query fails, like a Postgres server that went away. */
function brokenDatabase(): Database {
  const fail = async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
  };
  return { query: fail, transaction: fail, close: async () => {} };
}

describe('schema migrations', () => {
  it('creates the tables and records every migration in schema_migrations', async () => {
    const { testDb } = await makeApp();
    const db = await testDb.open();
    const { rows: tables } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name`,
    );
    expect(tables.map((t) => t.table_name)).toEqual([
      'applied_mutations',
      'meta',
      'record_history',
      'records',
      'schema_migrations',
    ]);
    const { rows: versions } = await db.query<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(versions.map((v) => v.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
  });

  it('does not re-run migrations on restart (data and versions untouched)', async () => {
    const first = await makeApp();
    await push(first.app, [mutation('vehicles', vehicle())]);
    await first.close();
    const second = await first.reopen();
    const db = await second.testDb.open();
    const { rows } = await db.query<{ n: number }>('SELECT count(*) AS n FROM schema_migrations');
    expect(rows[0]!.n).toBe(MIGRATIONS.length);
    expect((await pull(second.app)).body.changes).toHaveLength(1);
  });

  it('lets two server processes start against an empty schema at the same time', async () => {
    const testDb = await testDatabase();
    const [a, b] = await Promise.all([
      createApp({ database: await testDb.open() }),
      createApp({ database: await testDb.open() }),
    ]);
    try {
      const { body } = await push(a.app, [mutation('vehicles', vehicle())]);
      expect(body.results[0].status).toBe('applied');
      expect((await pull(b.app)).body.changes).toHaveLength(1);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('fails createApp with the database error when Postgres is unreachable', async () => {
    await expect(createApp({ database: brokenDatabase() })).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe('rev counter under concurrency', () => {
  it('gives concurrent pushes unique, gap-free revs and keeps each batch contiguous', async () => {
    const { app } = await makeApp();
    const batches = await Promise.all(
      Array.from({ length: 8 }, () =>
        push(app, Array.from({ length: 5 }, () => mutation('vehicles', vehicle()))).then((r) =>
          r.body.results.map((x: any) => x.rev as number),
        ),
      ),
    );
    const all = batches.flat().sort((x, y) => x - y);
    expect(all).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    for (const revs of batches) {
      expect(revs).toEqual(Array.from({ length: 5 }, (_, i) => revs[0]! + i));
    }
    const { body } = await pull(app, '?limit=1000');
    expect(body.changes).toHaveLength(40);
    expect(body.cursor).toBe(40);
  });

  it('applies the same mutationId only once when pushed concurrently from two requests', async () => {
    const { app } = await makeApp();
    const m = mutation('vehicles', vehicle());
    const [a, b] = await Promise.all([push(app, [m]), push(app, [m])]);
    const statuses = [a.body.results[0].status, b.body.results[0].status].sort();
    expect(statuses).toEqual(['applied', 'duplicate']);
    expect(a.body.results[0].rev).toBe(1);
    expect(b.body.results[0].rev).toBe(1);
  });
});

describe('value round-trips', () => {
  it('returns revs and epoch-ms timestamps as numbers, not strings', async () => {
    const { app, store } = await makeApp({ now: () => 1_800_000_000_123 });
    const v = vehicle({ updatedAt: 1_799_999_999_999 });
    await push(app, [mutation('vehicles', v)]);
    await push(app, [mutation('vehicles', { ...v, name: 'again' })]);
    const history = await store.history('vehicles', v.id);
    expect(history[0]).toEqual({ rev: 1, data: expect.objectContaining({ rev: 1 }), replacedAt: 1_800_000_000_123 });
    const { body } = await pull(app);
    expect(body.cursor).toBe(2);
    expect(body.changes[0].record.updatedAt).toBe(1_799_999_999_999);
  });

  it('round-trips unicode, nested values and decimals exactly', async () => {
    const { app } = await makeApp();
    const v = vehicle({ name: '小白 🚗 "quote" \\ back', plate: 'ABC-1234', model: 'line1\nline2', purchasePrice: 612345.75 });
    await push(app, [mutation('vehicles', v)]);
    const { body } = await pull(app);
    expect(body.changes[0].record).toEqual({ ...v, rev: 1 });
  });

  it('rejects (instead of failing the batch) a record containing a NUL character', async () => {
    const { app } = await makeApp();
    const bad = mutation('vehicles', vehicle({ name: 'a\u0000b' }));
    const good = mutation('vehicles', vehicle());
    const { res, body } = await push(app, [bad, good]);
    expect(res.status).toBe(200);
    expect(body.results[0]).toMatchObject({ mutationId: bad.mutationId, status: 'rejected' });
    expect(body.results[0].error).toMatch(/NUL/);
    expect(body.results[1]).toEqual({ mutationId: good.mutationId, status: 'applied', rev: 1 });
  });
});

describe('database outages', () => {
  it('reports /healthz 503 when the database stops answering', async () => {
    const { app, testDb } = await makeApp();
    expect((await app.request('/healthz')).status).toBe(200);
    // a second app whose database dies after startup
    const db = await testDb.open();
    let down = false;
    const flaky: Database = {
      query: (sql, params) => (down ? brokenDatabase().query(sql, params) : db.query(sql, params)),
      transaction: (fn) => (down ? brokenDatabase().transaction(fn) : db.transaction(fn)),
      close: () => db.close(),
    };
    const second = await createApp({ database: flaky });
    try {
      expect((await second.app.request('/healthz')).status).toBe(200);
      down = true;
      const res = await second.app.request('/healthz');
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: 'database unavailable' });
      const p = await push(second.app, [mutation('vehicles', vehicle())]);
      expect(p.res.status).toBe(500);
      expect(typeof p.body.error).toBe('string');
      expect((await pull(second.app)).res.status).toBe(500);
    } finally {
      await second.close();
    }
  });

  it('close() closes the database handle', async () => {
    const testDb = await testDatabase();
    let closed = 0;
    const db = await testDb.open();
    const server = await createApp({
      database: { ...db, close: async () => void closed++ },
    });
    await server.close();
    expect(closed).toBe(1);
  });
});
