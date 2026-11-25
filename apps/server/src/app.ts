import crypto from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { HTTPException } from 'hono/http-exception';
import {
  PULL_DEFAULT_LIMIT,
  PULL_MAX_LIMIT,
  PUSH_MAX_MUTATIONS,
  mutationSchema,
  type Mutation,
  type PullResponse,
  type PushResponse,
  type PushResult,
} from '@car-record/shared';
import type { Database } from './database';
import { Store } from './store';
import { serveStatic } from './static';

export interface CreateAppOptions {
  /** Postgres connection (node-postgres pool in production, PGlite in tests). Closed by close(). */
  database: Database;
  /** When non-empty, every /api/* request needs `Authorization: Bearer <apiToken>`. */
  apiToken?: string;
  /** Built web app (index.html, assets/, sw.js…). When unset, only API + /healthz are served. */
  staticDir?: string;
  /** Clock (epoch ms) used for audit timestamps; injectable for tests. */
  now?: () => number;
}

export interface ServerApp {
  app: Hono;
  /** Underlying storage (exposed for tests and maintenance tooling). */
  store: Store;
  /** Close the database. The Hono app must not be used afterwards. */
  close(): Promise<void>;
}

/** Generous cap on push bodies: 500 mutations of small JSON records fit easily. */
export const PUSH_MAX_BYTES = 10 * 1024 * 1024;
const NON_NEG_INT_RE = /^\d+$/;

const jsonError = (c: Context, status: 400 | 401 | 404 | 413 | 500 | 503, error: string) =>
  c.json({ error }, status);

function tokensEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function describeZodError(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  return issues
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ');
}

function parseNonNegInt(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined) return fallback;
  if (!NON_NEG_INT_RE.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** Create the app; runs pending database migrations first (rejects if Postgres is unreachable). */
export async function createApp(opts: CreateAppOptions): Promise<ServerApp> {
  const store = await Store.open(opts.database, opts.now);
  const apiToken = opts.apiToken || undefined;

  const app = new Hono();

  app.use(compress());

  app.get('/healthz', async (c) => {
    try {
      await store.ping();
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false, error: 'database unavailable' }, 503);
    }
  });

  // --- auth -----------------------------------------------------------------
  if (apiToken) {
    app.use('/api/*', async (c, next) => {
      const header = c.req.header('Authorization') ?? '';
      const match = /^Bearer (.+)$/.exec(header);
      if (!match || !tokensEqual(match[1]!, apiToken)) return jsonError(c, 401, 'Unauthorized');
      await next();
    });
  }

  // --- sync -----------------------------------------------------------------
  app.post(
    '/api/sync/push',
    bodyLimit({ maxSize: PUSH_MAX_BYTES, onError: (c) => jsonError(c, 413, 'Request body too large') }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return jsonError(c, 400, 'Malformed JSON body');
      }
      const raw = (body as { mutations?: unknown } | null)?.mutations;
      if (typeof body !== 'object' || body === null || Array.isArray(body) || !Array.isArray(raw)) {
        return jsonError(c, 400, 'Body must be { mutations: [...] }');
      }
      if (raw.length > PUSH_MAX_MUTATIONS) {
        return jsonError(c, 413, `Too many mutations (max ${PUSH_MAX_MUTATIONS})`);
      }

      const results: PushResult[] = new Array(raw.length);
      const valid: Mutation[] = [];
      const validIdx: number[] = [];
      raw.forEach((item, i) => {
        const parsed = mutationSchema.safeParse(item);
        // JSON.stringify writes U+0000 as the 6-character escape \u0000.
        if (parsed.success && JSON.stringify(parsed.data.record).includes('\\u0000')) {
          // Postgres JSONB cannot store U+0000; reject this one instead of failing the whole batch.
          results[i] = { mutationId: parsed.data.mutationId, status: 'rejected', error: 'NUL characters are not allowed' };
        } else if (parsed.success) {
          valid.push(parsed.data as Mutation);
          validIdx.push(i);
        } else {
          const id = (item as { mutationId?: unknown } | null)?.mutationId;
          results[i] = {
            mutationId: typeof id === 'string' ? id : '',
            status: 'rejected',
            error: describeZodError(parsed.error.issues),
          };
        }
      });

      const applied = await store.applyMutations(valid);
      applied.forEach((r, j) => {
        results[validIdx[j]!] = { mutationId: valid[j]!.mutationId, status: r.status, rev: r.rev };
      });

      return c.json({ results } satisfies PushResponse);
    },
  );

  app.get('/api/sync/pull', async (c) => {
    const since = parseNonNegInt(c.req.query('since'), 0);
    if (since === null) return jsonError(c, 400, 'since must be a non-negative integer');
    const limit = parseNonNegInt(c.req.query('limit'), PULL_DEFAULT_LIMIT);
    if (limit === null || limit < 1) return jsonError(c, 400, 'limit must be a positive integer');
    const page = await store.pull(since, Math.min(limit, PULL_MAX_LIMIT));
    return c.json(page satisfies PullResponse);
  });

  // Unknown API routes: JSON 404, never the SPA fallback.
  app.all('/api', (c) => jsonError(c, 404, 'Not found'));
  app.all('/api/*', (c) => jsonError(c, 404, 'Not found'));

  // --- static web app ------------------------------------------------------------
  if (opts.staticDir) {
    const staticDir = opts.staticDir;
    app.get('*', async (c, next) => {
      const res = await serveStatic(c, staticDir);
      if (res) return res;
      await next();
    });
  }

  app.notFound((c) => jsonError(c, 404, 'Not found'));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return jsonError(c, 500, 'Internal server error');
  });

  return {
    app,
    store,
    close: () => store.close(),
  };
}
