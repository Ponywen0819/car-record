import { describe, expect, it } from 'vitest';
import { makeApp, mutation, pull, push, vehicle } from './helpers';

describe('GET /healthz', () => {
  it('returns 200 {ok:true}', async () => {
    const { app } = await makeApp();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('never requires auth', async () => {
    const { app } = await makeApp({ apiToken: 'secret' });
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
  });
});

describe('auth', () => {
  it('allows /api requests without a token when apiToken is not set', async () => {
    const { app } = await makeApp();
    const { res } = await pull(app);
    expect(res.status).toBe(200);
  });

  it('treats an empty apiToken as disabled', async () => {
    const { app } = await makeApp({ apiToken: '' });
    const { res } = await pull(app);
    expect(res.status).toBe(200);
  });

  it.each([
    ['no header', {}],
    ['wrong token', { Authorization: 'Bearer nope' }],
    ['wrong scheme', { Authorization: 'Basic secret' }],
    ['bare token', { Authorization: 'secret' }],
    ['token prefix', { Authorization: 'Bearer secre' }],
  ])('returns 401 JSON for /api requests with %s', async (_n, headers) => {
    const { app } = await makeApp({ apiToken: 'secret' });
    for (const [path, init] of [
      ['/api/sync/pull', { headers }],
      ['/api/sync/push', { method: 'POST', headers, body: '{"mutations":[]}' }],
      ['/api/photos/abc', { headers }],
      ['/api/does-not-exist', { headers }],
    ] as const) {
      const res = await app.request(path, init);
      expect(res.status, path).toBe(401);
      expect(((await res.json()) as any).error).toBeTypeOf('string');
    }
  });

  it('accepts the correct bearer token', async () => {
    const { app } = await makeApp({ apiToken: 'secret' });
    const headers = { Authorization: 'Bearer secret' };
    const p = await push(app, [mutation('vehicles', vehicle())], headers);
    expect(p.res.status).toBe(200);
    const q = await pull(app, '', headers);
    expect(q.res.status).toBe(200);
    expect(q.body.changes).toHaveLength(1);
  });
});

describe('unknown routes', () => {
  it('returns 404 JSON for unknown /api paths', async () => {
    const { app } = await makeApp();
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(((await res.json()) as any).error).toBeTypeOf('string');
  });

  it('returns 404 JSON for non-api paths when no staticDir is configured', async () => {
    const { app } = await makeApp();
    const res = await app.request('/add/fuel');
    expect(res.status).toBe(404);
  });
});

describe('compression', () => {
  it('gzips large JSON responses when the client accepts gzip', async () => {
    const { app } = await makeApp();
    await push(app, Array.from({ length: 50 }, () => mutation('vehicles', vehicle())));
    const res = await app.request('/api/sync/pull', { headers: { 'Accept-Encoding': 'gzip' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    const raw = new Uint8Array(await res.arrayBuffer());
    const { gunzipSync } = await import('node:zlib');
    const parsed = JSON.parse(gunzipSync(raw).toString('utf8'));
    expect(parsed.changes).toHaveLength(50);
  });
});
