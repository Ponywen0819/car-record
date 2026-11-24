import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { createPgDatabase } from './database';

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env, import.meta.url);
} catch (err) {
  console.error(`car-record: ${(err as Error).message}`);
  process.exit(1);
}

const staticDir = config.staticDir && fs.existsSync(config.staticDir) ? config.staticDir : undefined;
const database = createPgDatabase(config.databaseUrl);

let server: Awaited<ReturnType<typeof createApp>>;
try {
  server = await createApp({ database, dataDir: config.dataDir, apiToken: config.apiToken, staticDir });
} catch (err) {
  // Fail fast; the container's restart policy retries until Postgres is reachable.
  console.error(`car-record: cannot start, database error: ${(err as Error).message}`);
  await database.close();
  process.exit(1);
}
const { app, close } = server;

const dbHost = (() => {
  try {
    const u = new URL(config.databaseUrl);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`; // never log the password
  } catch {
    return 'postgres';
  }
})();

const http = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `car-record server listening on http://0.0.0.0:${info.port} ` +
      `(db: ${dbHost}, photos: ${config.dataDir}, static: ${staticDir ?? `none${config.staticDir ? ` — ${config.staticDir} not found` : ''}`}, ` +
      `auth: ${config.apiToken ? 'bearer token' : 'off'})`,
  );
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  const force = setTimeout(() => {
    void close().finally(() => process.exit(1));
  }, 5000);
  force.unref();
  http.close(() => {
    void close().finally(() => process.exit(0));
  });
  // Drop idle keep-alive connections so close() can finish promptly.
  (http as { closeIdleConnections?: () => void }).closeIdleConnections?.();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
