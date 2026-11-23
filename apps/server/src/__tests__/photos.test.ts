import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeApp } from './helpers';

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

function put(app: ReturnType<typeof makeApp>['app'], id: string, body: Uint8Array<ArrayBuffer>, contentType = 'image/jpeg', headers: Record<string, string> = {}) {
  return app.request(`/api/photos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, ...headers },
    body,
  });
}

describe('photos', () => {
  it('stores a photo and serves it back with its content type and immutable caching', async () => {
    const { app, dataDir } = makeApp();
    const data = bytes(2048, 3);
    const res = await put(app, '0190a1b2-c3d4-7e5f-8a9b-0123456789ab', data, 'image/webp');
    expect(res.status).toBe(201);
    expect(fs.existsSync(path.join(dataDir, 'photos', '0190a1b2-c3d4-7e5f-8a9b-0123456789ab'))).toBe(true);

    const get = await app.request('/api/photos/0190a1b2-c3d4-7e5f-8a9b-0123456789ab', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/webp');
    expect(get.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(get.headers.get('content-encoding')).toBeNull(); // images are not gzipped
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(data);
  });

  it('is idempotent: re-PUT overwrites and returns 200', async () => {
    const { app } = makeApp();
    expect((await put(app, 'p1', bytes(10, 1), 'image/png')).status).toBe(201);
    const again = await put(app, 'p1', bytes(20, 2), 'image/jpeg');
    expect(again.status).toBe(200);
    const get = await app.request('/api/photos/p1');
    expect(get.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes(20, 2));
  });

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'IMAGE/JPEG; charset=binary'])(
    'accepts content type %s',
    async (ct) => {
      const { app } = makeApp();
      const res = await put(app, 'ok', bytes(4), ct);
      expect(res.status).toBe(201);
    },
  );

  it('returns 404 JSON for a missing photo', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/photos/missing');
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toBeTypeOf('string');
  });

  it.each(['text/plain', 'application/octet-stream', 'image/gif', 'image/svg+xml'])(
    'returns 415 for unsupported content type %s',
    async (ct) => {
      const { app, dataDir } = makeApp();
      const res = await put(app, 'x1', bytes(4), ct);
      expect(res.status).toBe(415);
      expect(((await res.json()) as any).error).toBeTypeOf('string');
      expect(fs.existsSync(path.join(dataDir, 'photos', 'x1'))).toBe(false);
    },
  );

  it('returns 415 when the content type is missing', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/photos/x2', { method: 'PUT', body: bytes(4) });
    expect(res.status).toBe(415);
  });

  it('returns 413 for bodies over 10 MB and stores nothing', async () => {
    const { app, dataDir } = makeApp();
    const res = await put(app, 'big', bytes(10 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
    expect(((await res.json()) as any).error).toBeTypeOf('string');
    expect(fs.existsSync(path.join(dataDir, 'photos', 'big'))).toBe(false);
    expect((await app.request('/api/photos/big')).status).toBe(404);
  });

  it('returns 413 based on a too-large Content-Length header', async () => {
    const { app } = makeApp();
    const res = await put(app, 'big2', bytes(10), 'image/jpeg', { 'Content-Length': String(11 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });

  it('accepts exactly 10 MB', async () => {
    const { app } = makeApp();
    const res = await put(app, 'edge', bytes(10 * 1024 * 1024));
    expect(res.status).toBe(201);
  });

  it('returns 400 for an empty body', async () => {
    const { app } = makeApp();
    const res = await put(app, 'empty', new Uint8Array(0));
    expect(res.status).toBe(400);
  });

  it.each([
    '..%2F..%2Fapp.db',
    '..%5Capp.db',
    'a.jpg',
    'has%20space',
    'x'.repeat(65),
    'semi%3Bcolon',
  ])('rejects invalid / path-traversal id %s with 400', async (id) => {
    const { app, dataDir } = makeApp();
    const res = await put(app, id, bytes(4));
    expect(res.status).toBe(400);
    const get = await app.request(`/api/photos/${id}`);
    expect(get.status).toBe(400);
    expect(fs.readdirSync(dataDir).filter((f) => f !== 'photos' && !f.startsWith('app.db'))).toEqual([]);
  });

  it.each(['%2E%2E', '..', '%2e%2e/%2e%2e/app.db'])(
    'dot-segment id %s is normalised away by the URL parser and never writes a file',
    async (id) => {
      const { app, dataDir } = makeApp();
      const res = await put(app, id, bytes(4));
      expect([400, 404]).toContain(res.status);
      expect(fs.readdirSync(path.join(dataDir, 'photos'))).toEqual([]);
      expect(fs.readdirSync(dataDir).filter((f) => f !== 'photos' && !f.startsWith('app.db'))).toEqual([]);
    },
  );

  it('accepts a 64-char id', async () => {
    const { app } = makeApp();
    const res = await put(app, 'a'.repeat(64), bytes(4));
    expect(res.status).toBe(201);
  });

  it('persists photos across app instances', async () => {
    const first = makeApp();
    await put(first.app, 'keep', bytes(8, 9), 'image/heic');
    first.close();
    const second = makeApp({ dataDir: first.dataDir });
    const get = await second.app.request('/api/photos/keep');
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/heic');
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes(8, 9));
  });
});
