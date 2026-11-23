import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';

// node:sqlite prints "ExperimentalWarning: SQLite is an experimental feature" on first load.
// db.ts loads it lazily via process.getBuiltinModule, so filtering here (before createApp)
// silences just that one warning while keeping every other warning visible.
const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const message = typeof warning === 'string' ? warning : warning.message;
  if (/SQLite is an experimental feature/.test(message)) return;
  return (originalEmitWarning as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

const config = loadConfig(process.env, import.meta.url);
const staticDir = config.staticDir && fs.existsSync(config.staticDir) ? config.staticDir : undefined;
const { app, close } = createApp({ dataDir: config.dataDir, apiToken: config.apiToken, staticDir });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `car-record server listening on http://0.0.0.0:${info.port} ` +
      `(data: ${config.dataDir}, static: ${staticDir ?? `none${config.staticDir ? ` — ${config.staticDir} not found` : ''}`}, ` +
      `auth: ${config.apiToken ? 'bearer token' : 'off'})`,
  );
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  const force = setTimeout(() => {
    close();
    process.exit(1);
  }, 5000);
  force.unref();
  server.close(() => {
    close();
    process.exit(0);
  });
  // Drop idle keep-alive connections so close() can finish promptly.
  (server as { closeIdleConnections?: () => void }).closeIdleConnections?.();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
