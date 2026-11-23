/**
 * In-memory fake of the sync server (SPEC.md §4.5), exposed as a `fetch`-compatible
 * function so engine tests do not depend on the real server.
 *
 * Protocol:
 *   POST /api/sync/push   { mutations } → { results: [{ mutationId, status, rev?, error? }] }
 *        each mutation validated on its own with mutationSchema; applied ones get the next
 *        global rev (the server overwrites any client rev); repeated mutationIds → 'duplicate'.
 *   GET  /api/sync/pull?since&limit → { changes, cursor, hasMore } (rev > since, rev asc).
 *   PUT  /api/photos/:id  body = image bytes; GET /api/photos/:id returns them.
 *
 * Switches: `offline` (fetch rejects with TypeError like a browser), `serverError`
 * (respond with that 5xx status), `token` (require `Authorization: Bearer <token>` → 401),
 * `rejectMutation` (force a 'rejected' result).
 */
import {
  mutationSchema,
  PULL_DEFAULT_LIMIT,
  PULL_MAX_LIMIT,
  type AnyRecord,
  type Change,
  type TableName,
} from '@car-record/shared';

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body?: unknown;
}

export interface StoredPhoto {
  bytes: Uint8Array;
  contentType: string;
}

export interface FakeServer {
  fetch: typeof fetch;
  /** fetch rejects with TypeError('Failed to fetch'). */
  offline: boolean;
  /** Process the next N requests normally, then fail them at network level (response lost). */
  dropResponses: number;
  /** When set, every request answers with this status (e.g. 500, 503). */
  serverError: number | null;
  /** When set, requests need `Authorization: Bearer <token>`; otherwise 401. */
  token: string | undefined;
  /** Return an error message to reject a (schema-valid) mutation. */
  rejectMutation: ((m: { mutationId: string; table: TableName; record: AnyRecord }) => string | undefined) | null;
  /** Current global revision. */
  readonly rev: number;
  requests: RecordedRequest[];
  /** Latest server copy of each record, keyed by `${table}:${id}`. */
  records: Map<string, { table: TableName; record: AnyRecord }>;
  /** Every applied mutation in order (for asserting push order). */
  applied: { mutationId: string; table: TableName; record: AnyRecord }[];
  photos: Map<string, StoredPhoto>;
  get(table: TableName, id: string): AnyRecord | undefined;
  /** Apply a change as if another device had pushed it. Returns the new rev. */
  seed(table: TableName, record: AnyRecord): number;
  requestsTo(path: string): RecordedRequest[];
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  new Headers(h).forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (body == null) return new Uint8Array();
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  const maybeBlob = body as { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof maybeBlob.arrayBuffer === 'function') return new Uint8Array(await maybeBlob.arrayBuffer());
  throw new Error('fakeServer: unsupported body type');
}

export function createFakeServer(): FakeServer {
  let rev = 0;
  const processed = new Map<string, number>(); // mutationId → rev it produced

  const server: FakeServer = {
    offline: false,
    dropResponses: 0,
    serverError: null,
    token: undefined,
    rejectMutation: null,
    get rev() {
      return rev;
    },
    requests: [],
    records: new Map(),
    applied: [],
    photos: new Map(),
    get(table, id) {
      return server.records.get(`${table}:${id}`)?.record;
    },
    seed(table, record) {
      rev += 1;
      server.records.set(`${table}:${record.id}`, { table, record: { ...record, rev } });
      return rev;
    },
    requestsTo(path) {
      return server.requests.filter((r) => r.path === path);
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await handle(input, init);
      if (server.dropResponses > 0) {
        server.dropResponses -= 1;
        throw new TypeError('Failed to fetch');
      }
      return response;
    }) as typeof fetch,
  };

  async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://fake.local');
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = headersToRecord(init?.headers);
      const query = Object.fromEntries(url.searchParams.entries());
      const req: RecordedRequest = { method, path: url.pathname, query, headers };
      server.requests.push(req);

      // Simulate the network boundary: the request never reaches the server.
      await Promise.resolve();
      if (server.offline) throw new TypeError('Failed to fetch');
      if (server.serverError !== null) return json(server.serverError, { error: 'server error' });
      if (server.token !== undefined && headers['authorization'] !== `Bearer ${server.token}`) {
        return json(401, { error: 'unauthorized' });
      }

      // ---- push --------------------------------------------------------------------
      if (url.pathname === '/api/sync/push' && method === 'POST') {
        let body: unknown;
        try {
          body = JSON.parse(typeof init?.body === 'string' ? init.body : '');
        } catch {
          return json(400, { error: 'invalid json' });
        }
        req.body = body;
        const mutations = (body as { mutations?: unknown }).mutations;
        if (!Array.isArray(mutations)) return json(400, { error: 'mutations must be an array' });

        const results = mutations.map((raw: unknown) => {
          const mutationId = String((raw as { mutationId?: unknown })?.mutationId ?? '');
          const seen = processed.get(mutationId);
          if (seen !== undefined) return { mutationId, status: 'duplicate' as const, rev: seen };
          const parsed = mutationSchema.safeParse(raw);
          if (!parsed.success) {
            return { mutationId, status: 'rejected' as const, error: parsed.error.issues[0]?.message ?? 'invalid' };
          }
          const m = parsed.data as { mutationId: string; table: TableName; record: AnyRecord };
          const forced = server.rejectMutation?.(m);
          if (forced) return { mutationId, status: 'rejected' as const, error: forced };
          rev += 1;
          const stored = { ...m.record, rev } as AnyRecord; // server overwrites any client rev
          server.records.set(`${m.table}:${m.record.id}`, { table: m.table, record: stored });
          server.applied.push({ mutationId: m.mutationId, table: m.table, record: stored });
          processed.set(mutationId, rev);
          return { mutationId, status: 'applied' as const, rev };
        });
        return json(200, { results });
      }

      // ---- pull --------------------------------------------------------------------
      if (url.pathname === '/api/sync/pull' && method === 'GET') {
        const since = Number(query['since'] ?? '0');
        const limit = Math.min(Number(query['limit'] ?? PULL_DEFAULT_LIMIT), PULL_MAX_LIMIT);
        if (!Number.isInteger(since) || since < 0 || !Number.isInteger(limit) || limit < 1) {
          return json(400, { error: 'bad query' });
        }
        const all = [...server.records.values()]
          .filter((r) => (r.record.rev ?? 0) > since)
          .sort((a, b) => (a.record.rev ?? 0) - (b.record.rev ?? 0));
        const page = all.slice(0, limit);
        const changes = page.map((r) => ({ table: r.table, record: r.record }) as Change);
        const cursor = page.length ? (page[page.length - 1]!.record.rev ?? since) : since;
        return json(200, { changes, cursor, hasMore: all.length > page.length });
      }

      // ---- photos ------------------------------------------------------------------
      const photoMatch = /^\/api\/photos\/([^/]+)$/.exec(url.pathname);
      if (photoMatch) {
        const id = decodeURIComponent(photoMatch[1]!);
        if (method === 'PUT') {
          const bytes = await bodyBytes(init?.body);
          server.photos.set(id, { bytes, contentType: headers['content-type'] ?? 'application/octet-stream' });
          return json(200, { id });
        }
        if (method === 'GET') {
          const photo = server.photos.get(id);
          if (!photo) return json(404, { error: 'not found' });
          return new Response(photo.bytes as unknown as BodyInit, { status: 200, headers: { 'Content-Type': photo.contentType } });
        }
      }

      return json(404, { error: 'not found' });
    }
  }
  return server;
}
