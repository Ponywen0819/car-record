import { describe, expect, it } from 'vitest';
import {
  PULL_DEFAULT_LIMIT,
  PULL_MAX_LIMIT,
  PUSH_MAX_MUTATIONS,
  pullResponseSchema,
  pushResponseSchema,
} from '@car-record/shared';
import { fuel, makeApp, mutation, pull, push, vehicle } from './helpers';

describe('POST /api/sync/push', () => {
  it('applies valid mutations and returns a rev per mutation in request order', async () => {
    const { app } = await makeApp();
    const m1 = mutation('vehicles', vehicle());
    const m2 = mutation('fuel', fuel());
    const { res, body } = await push(app, [m1, m2]);
    expect(res.status).toBe(200);
    expect(pushResponseSchema.safeParse(body).success).toBe(true);
    expect(body.results).toEqual([
      { mutationId: m1.mutationId, status: 'applied', rev: 1 },
      { mutationId: m2.mutationId, status: 'applied', rev: 2 },
    ]);
  });

  it('handles a mixed batch of applied / duplicate / rejected mutations', async () => {
    const { app } = await makeApp();
    const first = mutation('vehicles', vehicle());
    const r1 = await push(app, [first]);
    expect(r1.body.results[0]).toMatchObject({ status: 'applied', rev: 1 });

    const fresh = mutation('vehicles', vehicle());
    const invalid = mutation('vehicles', { id: 'bad', createdAt: 1, updatedAt: 1, fuelType: 'gasoline' }); // no name
    const badTable = mutation('nope', vehicle());
    const { res, body } = await push(app, [invalid, first, fresh, badTable]);
    expect(res.status).toBe(200);
    expect(pushResponseSchema.safeParse(body).success).toBe(true);
    const [a, b, c, d] = body.results;
    expect(a).toMatchObject({ mutationId: invalid.mutationId, status: 'rejected' });
    expect(typeof a.error).toBe('string');
    expect(a.rev).toBeUndefined();
    expect(b).toEqual({ mutationId: first.mutationId, status: 'duplicate', rev: 1 });
    expect(c).toEqual({ mutationId: fresh.mutationId, status: 'applied', rev: 2 });
    expect(d).toMatchObject({ mutationId: badTable.mutationId, status: 'rejected' });

    // duplicate was not re-applied, rejected was not stored
    const p = await pull(app);
    expect(p.body.changes).toHaveLength(2);
    expect(p.body.changes.map((ch: any) => ch.record.id)).not.toContain('bad');
  });

  it('rejects a mutation that is not even an object, with an empty-string mutationId', async () => {
    const { app } = await makeApp();
    const { body } = await push(app, [42, null, { table: 'vehicles' }]);
    expect(body.results).toHaveLength(3);
    for (const r of body.results) {
      expect(r.status).toBe('rejected');
      expect(typeof r.mutationId).toBe('string');
    }
  });

  it('treats a repeated mutationId within one batch as duplicate', async () => {
    const { app } = await makeApp();
    const m = mutation('vehicles', vehicle());
    const { body } = await push(app, [m, m]);
    expect(body.results).toEqual([
      { mutationId: m.mutationId, status: 'applied', rev: 1 },
      { mutationId: m.mutationId, status: 'duplicate', rev: 1 },
    ]);
  });

  it('assigns monotonically increasing revs across batches', async () => {
    const { app } = await makeApp();
    const revs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const { body } = await push(app, [mutation('vehicles', vehicle()), mutation('vehicles', vehicle())]);
      revs.push(...body.results.map((r: any) => r.rev));
    }
    expect(revs).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('ignores the client-sent rev and stores the server rev inside the record', async () => {
    const { app } = await makeApp();
    const v = vehicle({ rev: 999 });
    const { body } = await push(app, [mutation('vehicles', v)]);
    expect(body.results[0].rev).toBe(1);
    const p = await pull(app);
    expect(p.body.changes[0].record.rev).toBe(1);
  });

  it('last write wins by server receive order and keeps the old version in record_history', async () => {
    const { app, store } = await makeApp();
    const v1 = vehicle({ name: 'Old name' });
    await push(app, [mutation('vehicles', v1)]);
    // second write has an *older* client updatedAt, but server order still wins
    const v2 = { ...v1, name: 'New name', updatedAt: v1.updatedAt - 1000 };
    const { body } = await push(app, [mutation('vehicles', v2)]);
    expect(body.results[0]).toMatchObject({ status: 'applied', rev: 2 });

    const p = await pull(app);
    expect(p.body.changes).toHaveLength(1);
    expect(p.body.changes[0].record).toMatchObject({ id: v1.id, name: 'New name', rev: 2 });

    const history = await store.history('vehicles', v1.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.rev).toBe(1);
    expect(history[0]!.data).toMatchObject({ name: 'Old name', rev: 1 });
  });

  it('does not write history for a first insert', async () => {
    const { app, store } = await makeApp();
    const v = vehicle();
    await push(app, [mutation('vehicles', v)]);
    expect(await store.history('vehicles', v.id)).toEqual([]);
  });

  it('keeps the same id in different tables separate', async () => {
    const { app } = await makeApp();
    await push(app, [mutation('vehicles', vehicle({ id: 'same' })), mutation('fuel', fuel({ id: 'same' }))]);
    const p = await pull(app);
    expect(p.body.changes.map((c: any) => c.table).sort()).toEqual(['fuel', 'vehicles']);
  });

  it('returns 413 when the batch has more than PUSH_MAX_MUTATIONS', async () => {
    const { app } = await makeApp();
    const many = Array.from({ length: PUSH_MAX_MUTATIONS + 1 }, () => mutation('vehicles', vehicle()));
    const { res, body } = await push(app, many);
    expect(res.status).toBe(413);
    expect(typeof body.error).toBe('string');
    expect((await pull(app)).body.changes).toHaveLength(0);
  });

  it('accepts exactly PUSH_MAX_MUTATIONS', async () => {
    const { app } = await makeApp();
    const many = Array.from({ length: PUSH_MAX_MUTATIONS }, () => mutation('vehicles', vehicle()));
    const { res, body } = await push(app, many);
    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(PUSH_MAX_MUTATIONS);
    expect(body.results.at(-1).rev).toBe(PUSH_MAX_MUTATIONS);
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['mutations missing', JSON.stringify({})],
    ['mutations not an array', JSON.stringify({ mutations: { a: 1 } })],
    ['body is an array', JSON.stringify([])],
    ['body is null', 'null'],
  ])('returns 400 for a malformed body (%s)', async (_name, raw) => {
    const { app } = await makeApp();
    const res = await app.request('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    });
    expect(res.status).toBe(400);
    expect(typeof ((await res.json()) as any).error).toBe('string');
  });

  it('accepts an empty mutations array', async () => {
    const { app } = await makeApp();
    const { res, body } = await push(app, []);
    expect(res.status).toBe(200);
    expect(body).toEqual({ results: [] });
  });
});

describe('GET /api/sync/pull', () => {
  it('returns an empty, schema-valid response for a fresh db', async () => {
    const { app } = await makeApp();
    const { res, body } = await pull(app);
    expect(res.status).toBe(200);
    expect(pullResponseSchema.parse(body)).toEqual({ changes: [], cursor: 0, hasMore: false });
  });

  it('returns changes ordered by rev with the rev inside each record', async () => {
    const { app } = await makeApp();
    const v = vehicle();
    const f = fuel({ vehicleId: v.id });
    await push(app, [mutation('vehicles', v), mutation('fuel', f)]);
    const { body } = await pull(app, '?since=0');
    const parsed = pullResponseSchema.parse(body);
    expect(parsed.changes.map((c) => [c.table, c.record.id, c.record.rev])).toEqual([
      ['vehicles', v.id, 1],
      ['fuel', f.id, 2],
    ]);
    expect(parsed.cursor).toBe(2);
    expect(parsed.hasMore).toBe(false);
  });

  it('only returns rev > since and keeps cursor = since when empty', async () => {
    const { app } = await makeApp();
    await push(app, [mutation('vehicles', vehicle()), mutation('vehicles', vehicle())]);
    const a = await pull(app, '?since=1');
    expect(pullResponseSchema.parse(a.body).changes.map((c) => c.record.rev)).toEqual([2]);
    const b = await pull(app, '?since=2');
    expect(pullResponseSchema.parse(b.body)).toEqual({ changes: [], cursor: 2, hasMore: false });
    const c = await pull(app, '?since=50');
    expect(c.body).toEqual({ changes: [], cursor: 50, hasMore: false });
  });

  it('only returns the latest version of an overwritten record', async () => {
    const { app } = await makeApp();
    const v = vehicle();
    await push(app, [mutation('vehicles', v)]);
    await push(app, [mutation('vehicles', { ...v, name: 'v2' })]);
    const { body } = await pull(app);
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0].record).toMatchObject({ name: 'v2', rev: 2 });
    expect(body.cursor).toBe(2);
  });

  it('propagates soft deletes (deletedAt) via pull', async () => {
    const { app } = await makeApp();
    const v = vehicle();
    await push(app, [mutation('vehicles', v)]);
    const first = await pull(app);
    const cursor = first.body.cursor;
    await push(app, [mutation('vehicles', { ...v, deletedAt: 1_800_000_000_000 })]);
    const { body } = await pull(app, `?since=${cursor}`);
    const parsed = pullResponseSchema.parse(body);
    expect(parsed.changes).toHaveLength(1);
    expect(parsed.changes[0]!.record).toMatchObject({ id: v.id, deletedAt: 1_800_000_000_000, rev: 2 });
  });

  it('paginates with limit, hasMore and cursor', async () => {
    const { app } = await makeApp();
    await push(app, Array.from({ length: 5 }, () => mutation('vehicles', vehicle())));
    const seen: number[] = [];
    let since = 0;
    const pages: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      const { body } = await pull(app, `?since=${since}&limit=2`);
      const parsed = pullResponseSchema.parse(body);
      seen.push(...parsed.changes.map((c) => c.record.rev!));
      pages.push(parsed.hasMore);
      since = parsed.cursor;
      if (!parsed.hasMore) break;
    }
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(pages).toEqual([true, true, false]);
  });

  it('reports hasMore=false when the last page is exactly full', async () => {
    const { app } = await makeApp();
    await push(app, Array.from({ length: 4 }, () => mutation('vehicles', vehicle())));
    const a = await pull(app, '?limit=2');
    expect(a.body.hasMore).toBe(true);
    const b = await pull(app, `?since=${a.body.cursor}&limit=2`);
    expect(b.body.changes).toHaveLength(2);
    expect(b.body.hasMore).toBe(false);
  });

  it('defaults limit to PULL_DEFAULT_LIMIT and caps it at PULL_MAX_LIMIT', async () => {
    const { app } = await makeApp();
    const total = PULL_MAX_LIMIT + 5;
    for (let i = 0; i < total; i += 500) {
      await push(app, Array.from({ length: Math.min(500, total - i) }, () => mutation('vehicles', vehicle())));
    }
    const def = await pull(app);
    expect(def.body.changes).toHaveLength(PULL_DEFAULT_LIMIT);
    expect(def.body.hasMore).toBe(true);
    const capped = await pull(app, `?limit=${PULL_MAX_LIMIT * 10}`);
    expect(capped.body.changes).toHaveLength(PULL_MAX_LIMIT);
    expect(capped.body.cursor).toBe(PULL_MAX_LIMIT);
    expect(capped.body.hasMore).toBe(true);
  });

  it.each(['?since=-1', '?since=abc', '?since=1.5', '?limit=0', '?limit=-3', '?limit=x', '?since=', '?limit=1e3'])(
    'returns 400 for invalid params %s',
    async (q) => {
      const { app } = await makeApp();
      const { res, body } = await pull(app, q);
      expect(res.status).toBe(400);
      expect(typeof body.error).toBe('string');
    },
  );
});

describe('persistence', () => {
  it('keeps data and the rev counter across app instances on the same database', async () => {
    const first = await makeApp();
    const v = vehicle();
    const m = mutation('vehicles', v);
    await push(first.app, [m]);
    await first.close();

    const second = await first.reopen();
    const p = await pull(second.app);
    expect(p.body.changes.map((c: any) => c.record.id)).toEqual([v.id]);
    // idempotency survives a restart
    const dup = await push(second.app, [m]);
    expect(dup.body.results[0]).toEqual({ mutationId: m.mutationId, status: 'duplicate', rev: 1 });
    // rev keeps increasing
    const next = await push(second.app, [mutation('vehicles', vehicle())]);
    expect(next.body.results[0].rev).toBe(2);
  });
});
