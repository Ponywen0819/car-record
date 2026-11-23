import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeApp, tmpDir } from './helpers';

const INDEX = '<!doctype html><html><head><title>Car Record</title></head><body><div id="root"></div></body></html>';

function makeStatic() {
  const dir = tmpDir('car-record-static-');
  const write = (rel: string, content: string) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  write('index.html', INDEX);
  write('sw.js', 'self.addEventListener("fetch", () => {});');
  write('registerSW.js', 'navigator.serviceWorker.register("/sw.js")');
  write('manifest.webmanifest', '{"name":"Car Record"}');
  write('workbox-1a2b3c.js', '/* workbox */');
  write('assets/index-abc123.js', 'console.log(1);'.repeat(200));
  write('assets/index-abc123.css', 'body{color:red}');
  write('icons/icon-192.png', 'PNGDATA');
  write('favicon.ico', 'ICO');
  return dir;
}

describe('static files', () => {
  it('serves index.html at / with no-cache', async () => {
    const { app } = makeApp({ staticDir: makeStatic() });
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe(INDEX);
  });

  it('does not require auth for static files even when apiToken is set', async () => {
    const { app } = makeApp({ staticDir: makeStatic(), apiToken: 'secret' });
    expect((await app.request('/')).status).toBe(200);
    expect((await app.request('/assets/index-abc123.js')).status).toBe(200);
    expect((await app.request('/add/fuel')).status).toBe(200);
  });

  it.each([
    ['/index.html', /^text\/html/],
    ['/sw.js', /javascript/],
    ['/registerSW.js', /javascript/],
    ['/manifest.webmanifest', /^application\/manifest\+json/],
    ['/workbox-1a2b3c.js', /javascript/],
  ])('serves %s with no-cache', async (p, ct) => {
    const { app } = makeApp({ staticDir: makeStatic() });
    const res = await app.request(p);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(ct);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it.each([
    ['/assets/index-abc123.js', /javascript/],
    ['/assets/index-abc123.css', /^text\/css/],
  ])('serves hashed asset %s with long-term immutable caching', async (p, ct) => {
    const { app } = makeApp({ staticDir: makeStatic() });
    const res = await app.request(p);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(ct);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('serves other files with their mime type', async () => {
    const { app } = makeApp({ staticDir: makeStatic() });
    const res = await app.request('/icons/icon-192.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(await res.text()).toBe('PNGDATA');
  });

  it.each(['/add/fuel', '/vehicles/123', '/settings'])('falls back to index.html for SPA route %s', async (p) => {
    const { app } = makeApp({ staticDir: makeStatic() });
    const res = await app.request(p);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe(INDEX);
  });

  it('returns 404 (not index.html) for missing files that look like files', async () => {
    const { app } = makeApp({ staticDir: makeStatic() });
    for (const p of ['/assets/missing-123.js', '/nope.png']) {
      const res = await app.request(p);
      expect(res.status, p).toBe(404);
    }
  });

  it('does not fall back to index.html for unknown /api paths', async () => {
    const { app } = makeApp({ staticDir: makeStatic() });
    for (const p of ['/api/nope', '/api', '/api/sync/unknown']) {
      const res = await app.request(p);
      expect(res.status, p).toBe(404);
      expect(res.headers.get('content-type'), p).toMatch(/application\/json/);
    }
  });

  it('does not serve index.html fallback for non-GET methods', async () => {
    const { app } = makeApp({ staticDir: makeStatic() });
    const res = await app.request('/add/fuel', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('supports HEAD', async () => {
    const { app } = makeApp({ staticDir: makeStatic() });
    const res = await app.request('/index.html', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
  });

  it('cannot escape the static dir via path traversal', async () => {
    const root = tmpDir('car-record-root-');
    const staticDir = path.join(root, 'public');
    fs.mkdirSync(staticDir);
    fs.writeFileSync(path.join(staticDir, 'index.html'), INDEX);
    fs.writeFileSync(path.join(root, 'secret.txt'), 'TOP SECRET');
    const { app } = makeApp({ staticDir });
    for (const p of ['/..%2Fsecret.txt', '/%2e%2e/secret.txt', '/..%5Csecret.txt', '/assets/..%2F..%2Fsecret.txt']) {
      const res = await app.request(p);
      const text = await res.text();
      expect(text, p).not.toContain('TOP SECRET');
    }
  });

  it('gzips compressible static text responses', async () => {
    const { app } = makeApp({ staticDir: makeStatic() });
    const res = await app.request('/assets/index-abc123.js', { headers: { 'Accept-Encoding': 'gzip' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
  });

  it('behaves sanely when staticDir does not exist', async () => {
    const { app } = makeApp({ staticDir: path.join(tmpDir(), 'missing') });
    expect((await app.request('/add/fuel')).status).toBe(404);
    expect((await app.request('/healthz')).status).toBe(200);
  });
});
