import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ServerConfig {
  port: number;
  dataDir: string;
  apiToken?: string;
  /** undefined = don't serve static files (API only). */
  staticDir?: string;
}

/**
 * Default location of the web build, relative to the running module.
 * Both `src/main.ts` (tsx dev) and `dist/main.js` (bundle) sit one level below the server
 * package root, so `../../web/dist` is the monorepo's apps/web/dist in both cases.
 * A `../public` directory next to the bundle (container layout) wins if it has an index.html.
 */
function defaultStaticDir(moduleUrl: string): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const candidates = [path.resolve(moduleDir, '../../web/dist'), path.resolve(moduleDir, '../public')];
  return candidates.find((d) => fs.existsSync(path.join(d, 'index.html'))) ?? candidates[0]!;
}

export function loadConfig(
  env: Record<string, string | undefined>,
  moduleUrl: string,
  cwd: string = process.cwd(),
): ServerConfig {
  const rawPort = env.PORT ?? '8080';
  const port = /^\d+$/.test(rawPort) ? Number(rawPort) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${JSON.stringify(rawPort)}`);
  }
  const staticDir =
    env.STATIC_DIR === undefined
      ? defaultStaticDir(moduleUrl)
      : env.STATIC_DIR === ''
        ? undefined
        : path.resolve(cwd, env.STATIC_DIR);
  return {
    port,
    dataDir: path.resolve(cwd, env.DATA_DIR || 'data'),
    apiToken: env.API_TOKEN || undefined,
    staticDir,
  };
}
