/** Sanity checks so engine tests can trust the fake server. */
import { describe, expect, it } from 'vitest';
import { createFakeServer } from './fakeServer';

const vehicle = (id: string, name = 'Car') =>
  ({ id, createdAt: 1, updatedAt: 1, name, fuelType: 'gasoline' }) as const;

async function push(server: ReturnType<typeof createFakeServer>, mutations: unknown[]) {
  const res = await server.fetch('/api/sync/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mutations }),
  });
  return { status: res.status, body: await res.json() };
}

describe('fakeServer', () => {
  it('applies valid mutations with a global rev, overwriting client rev', async () => {
    const server = createFakeServer();
    const { body } = await push(server, [
      { mutationId: 'm1', table: 'vehicles', record: { ...vehicle('a'), rev: 999 } },
      { mutationId: 'm2', table: 'vehicles', record: vehicle('b') },
    ]);
    expect(body.results).toEqual([
      { mutationId: 'm1', status: 'applied', rev: 1 },
      { mutationId: 'm2', status: 'applied', rev: 2 },
    ]);
    expect(server.get('vehicles', 'a')?.rev).toBe(1);
  });

  it('reports duplicates and rejects invalid mutations individually', async () => {
    const server = createFakeServer();
    await push(server, [{ mutationId: 'm1', table: 'vehicles', record: vehicle('a') }]);
    const { body } = await push(server, [
      { mutationId: 'm1', table: 'vehicles', record: vehicle('a', 'changed') },
      { mutationId: 'm2', table: 'vehicles', record: { id: 'x' } },
      { mutationId: 'm3', table: 'vehicles', record: vehicle('c') },
    ]);
    expect(body.results.map((r: { status: string }) => r.status)).toEqual(['duplicate', 'rejected', 'applied']);
    expect(body.results[0].rev).toBe(1);
    expect(server.get('vehicles', 'a')).toMatchObject({ name: 'Car' });
  });

  it('pulls incrementally with limit / hasMore / cursor', async () => {
    const server = createFakeServer();
    for (const id of ['a', 'b', 'c']) server.seed('vehicles', vehicle(id));
    const p1 = await (await server.fetch('/api/sync/pull?since=0&limit=2')).json();
    expect(p1).toMatchObject({ cursor: 2, hasMore: true });
    expect(p1.changes.map((c: { record: { id: string } }) => c.record.id)).toEqual(['a', 'b']);
    const p2 = await (await server.fetch('/api/sync/pull?since=2&limit=2')).json();
    expect(p2).toMatchObject({ cursor: 3, hasMore: false });
    const p3 = await (await server.fetch('/api/sync/pull?since=3')).json();
    expect(p3).toEqual({ changes: [], cursor: 3, hasMore: false });
  });

  it('enforces the bearer token and simulates failures', async () => {
    const server = createFakeServer();
    server.token = 'secret';
    expect((await server.fetch('/api/sync/pull?since=0')).status).toBe(401);
    expect(
      (await server.fetch('/api/sync/pull?since=0', { headers: { Authorization: 'Bearer secret' } })).status,
    ).toBe(200);
    server.token = undefined;
    server.serverError = 503;
    expect((await server.fetch('/api/sync/pull?since=0')).status).toBe(503);
    server.serverError = null;
    server.offline = true;
    await expect(server.fetch('/api/sync/pull?since=0')).rejects.toBeInstanceOf(TypeError);
    server.offline = false;
    server.dropResponses = 1;
    await expect(push(server, [{ mutationId: 'm1', table: 'vehicles', record: vehicle('a') }])).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(server.get('vehicles', 'a')).toBeDefined(); // processed even though the response was lost
  });
});
