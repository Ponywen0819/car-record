import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { tmpDir } from './helpers';

/** Fake server package layout: <root>/apps/server/{src,dist}/main.*, <root>/apps/web/dist/index.html */
function layout(withWebBuild = true) {
  const root = tmpDir('car-record-layout-');
  const server = path.join(root, 'apps', 'server');
  fs.mkdirSync(path.join(server, 'src'), { recursive: true });
  fs.mkdirSync(path.join(server, 'dist'), { recursive: true });
  const web = path.join(root, 'apps', 'web', 'dist');
  if (withWebBuild) {
    fs.mkdirSync(web, { recursive: true });
    fs.writeFileSync(path.join(web, 'index.html'), '<html></html>');
  }
  return { root, server, web };
}

const ENV = { DATABASE_URL: 'postgres://localhost/car_record' };

describe('loadConfig', () => {
  it('uses defaults', () => {
    const { server, web } = layout();
    const cfg = loadConfig(ENV, pathToFileURL(path.join(server, 'src', 'main.ts')).href, '/cwd');
    expect(cfg.port).toBe(8080);
    expect(cfg.databaseUrl).toBe('postgres://localhost/car_record');
    expect(cfg).not.toHaveProperty('dataDir');
    expect(cfg.apiToken).toBeUndefined();
    expect(cfg.staticDir).toBe(web);
  });

  it('resolves the web build from the bundled dist/main.js too', () => {
    const { server, web } = layout();
    const cfg = loadConfig(ENV, pathToFileURL(path.join(server, 'dist', 'main.js')).href, '/cwd');
    expect(cfg.staticDir).toBe(web);
  });

  it('falls back to <dist>/../public when it exists (container layout)', () => {
    const root = tmpDir('car-record-layout-');
    fs.mkdirSync(path.join(root, 'dist'));
    fs.mkdirSync(path.join(root, 'public'));
    fs.writeFileSync(path.join(root, 'public', 'index.html'), '');
    const cfg = loadConfig(ENV, pathToFileURL(path.join(root, 'dist', 'main.js')).href, '/cwd');
    expect(cfg.staticDir).toBe(path.join(root, 'public'));
  });

  it('still points at ../web/dist when no build exists (so the startup log shows where it looked)', () => {
    const { server, web } = layout(false);
    const cfg = loadConfig(ENV, pathToFileURL(path.join(server, 'dist', 'main.js')).href, '/cwd');
    expect(cfg.staticDir).toBe(web);
  });

  it('reads env overrides', () => {
    const { server } = layout();
    const cfg = loadConfig(
      {
        PORT: '3000',
        DATA_DIR: '/srv/data', // no longer used: ignored
        API_TOKEN: 'tok',
        STATIC_DIR: '/srv/www',
        DATABASE_URL: 'postgres://car:pw@db.lan:5433/car_record',
      },
      pathToFileURL(path.join(server, 'src', 'main.ts')).href,
      '/cwd',
    );
    expect(cfg).toEqual({
      port: 3000,
      databaseUrl: 'postgres://car:pw@db.lan:5433/car_record',
      apiToken: 'tok',
      staticDir: path.resolve('/cwd', '/srv/www'),
    });
  });

  it('treats empty API_TOKEN as unset and empty STATIC_DIR as "no static files"', () => {
    const { server } = layout();
    const cfg = loadConfig({ ...ENV, API_TOKEN: '', STATIC_DIR: '' }, pathToFileURL(path.join(server, 'src', 'main.ts')).href, '/cwd');
    expect(cfg.apiToken).toBeUndefined();
    expect(cfg.staticDir).toBeUndefined();
  });

  it.each(['abc', '0', '70000', '-1', '80.5'])('rejects invalid PORT %s', (port) => {
    const { server } = layout();
    expect(() => loadConfig({ ...ENV, PORT: port }, pathToFileURL(path.join(server, 'src', 'main.ts')).href, '/cwd')).toThrow(
      /PORT/,
    );
  });

  it.each([{}, { DATABASE_URL: '' }, { DATABASE_URL: '   ' }])('requires DATABASE_URL (%o)', (env) => {
    const { server } = layout();
    expect(() => loadConfig(env, pathToFileURL(path.join(server, 'src', 'main.ts')).href, '/cwd')).toThrow(
      /DATABASE_URL/,
    );
  });

  it.each(['mysql://localhost/db', 'not a url', 'http://localhost/db'])('rejects non-Postgres DATABASE_URL %s', (url) => {
    const { server } = layout();
    expect(() =>
      loadConfig({ DATABASE_URL: url }, pathToFileURL(path.join(server, 'src', 'main.ts')).href, '/cwd'),
    ).toThrow(/DATABASE_URL/);
  });

  it.each(['postgres://u:p@h/db', 'postgresql://h:5432/db?sslmode=require'])('accepts %s', (url) => {
    const { server } = layout();
    const cfg = loadConfig({ DATABASE_URL: url }, pathToFileURL(path.join(server, 'src', 'main.ts')).href, '/cwd');
    expect(cfg.databaseUrl).toBe(url);
  });
});
