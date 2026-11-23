/**
 * Sync engine contract (SPEC.md §4.5). Owned by the sync workstream.
 *
 * syncNow():
 *   1. Push pending outbox entries in seq order, in batches (PUSH_MAX_MUTATIONS).
 *      - 'applied' | 'duplicate' → delete the outbox entry; set `rev` on the cached record
 *        unless a newer outbox entry for the same record exists.
 *      - 'rejected' → status 'failed', lastError = error. Not retried automatically.
 *      - network error / 5xx → keep pending, attempts++, exponential backoff
 *        (1s, 2s, 4s … capped at 5 min) before the next automatic attempt.
 *      - 401 → state 'error', lastError 'unauthorized'.
 *   2. Upload pending photos: PUT {baseUrl}/api/photos/:id with the blob body and its
 *      Content-Type; on 2xx set status 'uploaded' and drop the blob.
 *   3. Pull: GET {baseUrl}/api/sync/pull?since=<cursor>&limit=… until hasMore is false.
 *      Put each changed record into the cache EXCEPT records that still have a pending
 *      outbox entry (local changes win until pushed). Save the cursor in meta.
 *   Concurrent calls share the in-flight run. Never throws: errors go into the status.
 *
 * start(): sync on start, on window 'online', on document 'visibilitychange' → visible,
 *   every intervalMs (default 5 min) while started, and debounceMs (default 2 s) after a
 *   `localWrites` 'write' event. stop() removes all of it.
 *
 * Status: 'offline' when online() is false or the fetch failed at network level;
 *   'syncing' while running; 'error' after a non-network failure; else 'idle'.
 *   `pending` / `failed` = outbox counts by status (+ pending photos in `pending`).
 *   Requests send `Authorization: Bearer <token>` when getToken() returns a value.
 *
 * Implementation notes (beyond the contract):
 * - Backoff only gates AUTOMATIC triggers (interval, debounced writes, visibility). A retry
 *   timer fires after backoffDelay(n) while started. `syncNow()` called directly always
 *   attempts; the window 'online' event cancels the backoff and syncs immediately.
 * - An automatic trigger that arrives while a run is in flight schedules one follow-up run
 *   after it, so a write made mid-sync is not left waiting for the next interval.
 * - A batch-level 4xx on push (other than 401) marks that batch 'failed' (no endless retry).
 * - Pull stores server records as-is after a light shape check (table known, record.id),
 *   so additive schema changes on the server do not stall sync on older clients.
 */
import {
  PULL_DEFAULT_LIMIT,
  PUSH_MAX_MUTATIONS,
  pushResponseSchema,
  TABLES,
  type AnyRecord,
  type PushResult,
  type TableName,
} from '@car-record/shared';
import { META_CURSOR, META_LAST_SYNC_AT, type CarDB, type OutboxEntry } from '../db/db';
import { localWrites } from '../db/repository';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  failed: number;
  lastSyncAt?: number;
  lastError?: string;
}

export interface SyncEngineOptions {
  db: CarDB;
  /** '' = same origin. */
  baseUrl?: string;
  fetch?: typeof fetch;
  getToken?: () => string | undefined;
  now?: () => number;
  online?: () => boolean;
  intervalMs?: number;
  debounceMs?: number;
  pullLimit?: number;
}

export interface SyncEngine {
  syncNow(): Promise<SyncStatus>;
  start(): void;
  stop(): void;
  getStatus(): SyncStatus;
  /** Called immediately with the current status, then on every change. Returns unsubscribe. */
  subscribe(listener: (status: SyncStatus) => void): () => void;
  /** Move failed outbox entries back to pending and sync. */
  retryFailed(): Promise<SyncStatus>;
}

export const DEFAULT_SYNC_INTERVAL_MS = 5 * 60_000;
export const DEFAULT_SYNC_DEBOUNCE_MS = 2_000;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

/** Delay before the n-th automatic retry after n consecutive failures: 1s, 2s, 4s … ≤ 5 min. */
export function backoffDelay(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
}

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

/** Why a run stopped early. `retry` = transient: back off and try again. */
class SyncFailure extends Error {
  constructor(
    readonly kind: 'network' | 'unauthorized' | 'server' | 'invalid',
    message: string,
  ) {
    super(message);
  }
  get state(): SyncState {
    return this.kind === 'network' ? 'offline' : 'error';
  }
  get retry(): boolean {
    return this.kind === 'network' || this.kind === 'server' || this.kind === 'invalid';
  }
}

const KNOWN_TABLES: ReadonlySet<string> = new Set(TABLES);

function defaultOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function sameStatus(a: SyncStatus, b: SyncStatus): boolean {
  return (
    a.state === b.state &&
    a.pending === b.pending &&
    a.failed === b.failed &&
    a.lastSyncAt === b.lastSyncAt &&
    a.lastError === b.lastError
  );
}

export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const { db } = options;
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const getToken = options.getToken ?? (() => undefined);
  const now = options.now ?? (() => Date.now());
  const online = options.online ?? defaultOnline;
  const intervalMs = options.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  const debounceMs = options.debounceMs ?? DEFAULT_SYNC_DEBOUNCE_MS;
  const pullLimit = options.pullLimit ?? PULL_DEFAULT_LIMIT;
  const recordTables = TABLES.map((t) => db.tableFor(t));

  let status: SyncStatus = { state: 'idle', pending: 0, failed: 0 };
  const listeners = new Set<(s: SyncStatus) => void>();

  let inFlight: Promise<SyncStatus> | null = null;
  let rerunRequested = false;
  let failures = 0;

  let started = false;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- status ------------------------------------------------------------------------

  function snapshot(): SyncStatus {
    const s: SyncStatus = { state: status.state, pending: status.pending, failed: status.failed };
    if (status.lastSyncAt !== undefined) s.lastSyncAt = status.lastSyncAt;
    if (status.lastError !== undefined) s.lastError = status.lastError;
    return s;
  }

  function setStatus(patch: Partial<SyncStatus>): void {
    const next: SyncStatus = { ...status, ...patch };
    if (next.lastError === undefined) delete next.lastError;
    if (next.lastSyncAt === undefined) delete next.lastSyncAt;
    if (sameStatus(next, status)) return;
    status = next;
    const snap = snapshot();
    for (const l of [...listeners]) {
      try {
        l(snap);
      } catch {
        // A faulty listener must not break sync.
      }
    }
  }

  async function refreshCounts(): Promise<void> {
    try {
      const [pendingOutbox, failed, pendingPhotos] = await Promise.all([
        db.outbox.where('status').equals('pending').count(),
        db.outbox.where('status').equals('failed').count(),
        db.photos.where('status').equals('pending').count(),
      ]);
      const patch: Partial<SyncStatus> = { pending: pendingOutbox + pendingPhotos, failed };
      if (status.lastSyncAt === undefined) {
        const last = (await db.meta.get(META_LAST_SYNC_AT))?.value;
        if (typeof last === 'number') patch.lastSyncAt = last;
      }
      setStatus(patch);
    } catch {
      // DB closed / unavailable: keep the last known counts.
    }
  }

  // ---- HTTP --------------------------------------------------------------------------

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, { ...init, headers });
    } catch (err) {
      throw new SyncFailure('network', err instanceof Error ? err.message : 'network error');
    }
    if (res.status === 401) throw new SyncFailure('unauthorized', 'unauthorized');
    if (res.status >= 500) throw new SyncFailure('server', `server error ${res.status}`);
    return res;
  }

  async function readJson(res: Response, what: string): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new SyncFailure('invalid', `invalid ${what} response`);
    }
  }

  // ---- push --------------------------------------------------------------------------

  async function bumpAttempts(seqs: number[]): Promise<void> {
    await db.outbox
      .where('seq')
      .anyOf(seqs)
      .modify((e) => {
        e.attempts += 1;
      });
  }

  async function push(): Promise<void> {
    let afterSeq = 0;
    for (;;) {
      const batch = await db.outbox
        .where('seq')
        .above(afterSeq)
        .filter((e) => e.status === 'pending')
        .limit(PUSH_MAX_MUTATIONS)
        .toArray();
      if (batch.length === 0) return;
      const seqs = batch.map((e) => e.seq!);
      afterSeq = seqs[seqs.length - 1]!;

      let res: Response;
      try {
        res = await request('/api/sync/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mutations: batch.map((e) => ({ mutationId: e.mutationId, table: e.table, record: e.record })),
          }),
        });
      } catch (err) {
        if (err instanceof SyncFailure && err.retry) await bumpAttempts(seqs);
        throw err;
      }

      if (!res.ok) {
        // Whole batch refused (4xx other than 401): mark failed so it is not retried forever.
        const text = await res.text().catch(() => '');
        const error = `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`;
        await db.outbox
          .where('seq')
          .anyOf(seqs)
          .modify((e) => {
            e.status = 'failed';
            e.attempts += 1;
            e.lastError = error;
          });
        continue;
      }

      const parsed = pushResponseSchema.safeParse(await readJson(res, 'push').catch(async (err) => {
        await bumpAttempts(seqs);
        throw err;
      }));
      if (!parsed.success) {
        await bumpAttempts(seqs);
        throw new SyncFailure('invalid', 'invalid push response');
      }
      await applyPushResults(batch, parsed.data.results);
    }
  }

  async function applyPushResults(batch: OutboxEntry[], results: PushResult[]): Promise<void> {
    const byId = new Map(results.map((r) => [r.mutationId, r]));
    await db.transaction('rw', [db.outbox, ...recordTables], async () => {
      for (const entry of batch) {
        const result = byId.get(entry.mutationId);
        const seq = entry.seq!;
        if (!result) {
          await db.outbox.update(seq, { attempts: entry.attempts + 1 });
          continue;
        }
        if (result.status === 'rejected') {
          await db.outbox.update(seq, {
            status: 'failed',
            attempts: entry.attempts + 1,
            lastError: result.error ?? 'rejected by server',
          });
          continue;
        }
        // applied | duplicate
        await db.outbox.delete(seq);
        if (result.rev === undefined) continue;
        const newer = await db.outbox
          .where('recordId')
          .equals(entry.recordId)
          .filter((e) => e.table === entry.table && e.seq! > seq)
          .count();
        if (newer > 0) continue;
        const table = db.tableFor(entry.table);
        const cached = await table.get(entry.recordId);
        if (cached && (cached.rev === undefined || cached.rev < result.rev)) {
          await table.update(entry.recordId, { rev: result.rev });
        }
      }
    });
  }

  // ---- photos ------------------------------------------------------------------------

  /** Returns an error message if some upload was refused (4xx), else undefined. */
  async function uploadPhotos(): Promise<string | undefined> {
    const pending = await db.photos.where('status').equals('pending').toArray();
    let refused: string | undefined;
    for (const photo of pending) {
      if (!photo.blob) continue;
      const res = await request(`/api/photos/${encodeURIComponent(photo.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': photo.contentType },
        body: photo.blob,
      });
      if (!res.ok) {
        refused = `photo upload failed: HTTP ${res.status}`;
        continue;
      }
      await db.photos.put({
        id: photo.id,
        contentType: photo.contentType,
        status: 'uploaded',
        createdAt: photo.createdAt,
      });
    }
    return refused;
  }

  // ---- pull --------------------------------------------------------------------------

  async function pull(): Promise<void> {
    const stored = (await db.meta.get(META_CURSOR))?.value;
    let cursor = typeof stored === 'number' && stored >= 0 ? stored : 0;
    for (;;) {
      const res = await request(`/api/sync/pull?since=${cursor}&limit=${pullLimit}`);
      if (!res.ok) throw new SyncFailure('invalid', `pull failed: HTTP ${res.status}`);
      const body = (await readJson(res, 'pull')) as {
        changes?: unknown;
        cursor?: unknown;
        hasMore?: unknown;
      } | null;
      if (
        !body ||
        !Array.isArray(body.changes) ||
        typeof body.cursor !== 'number' ||
        !Number.isInteger(body.cursor) ||
        typeof body.hasMore !== 'boolean'
      ) {
        throw new SyncFailure('invalid', 'invalid pull response');
      }
      const nextCursor = body.cursor;
      const changes = body.changes as { table?: unknown; record?: { id?: unknown; rev?: unknown } }[];

      await db.transaction('rw', [db.outbox, db.meta, ...recordTables], async () => {
        for (const change of changes) {
          if (typeof change?.table !== 'string' || !KNOWN_TABLES.has(change.table)) continue;
          const record = change.record as AnyRecord | undefined;
          if (!record || typeof record.id !== 'string') continue;
          const tableName = change.table as TableName;
          const hasPending = await db.outbox
            .where('recordId')
            .equals(record.id)
            .filter((e) => e.status === 'pending' && e.table === tableName)
            .count();
          if (hasPending > 0) continue; // local changes win until pushed
          const table = db.tableFor(tableName);
          const cached = await table.get(record.id);
          if (cached?.rev !== undefined && typeof record.rev === 'number' && cached.rev > record.rev) continue;
          await table.put(record as never);
        }
        await db.meta.put({ key: META_CURSOR, value: nextCursor });
      });

      if (!body.hasMore) return;
      if (nextCursor <= cursor) throw new SyncFailure('invalid', 'pull cursor did not advance');
      cursor = nextCursor;
    }
  }

  // ---- run ---------------------------------------------------------------------------

  async function run(): Promise<SyncStatus> {
    if (!online()) {
      await refreshCounts();
      setStatus({ state: 'offline' });
      return snapshot();
    }
    try {
      await push();
      const photoError = await uploadPhotos();
      await pull();
      const at = now();
      await db.meta.put({ key: META_LAST_SYNC_AT, value: at });
      failures = 0;
      clearRetry();
      await refreshCounts();
      setStatus({
        state: photoError ? 'error' : 'idle',
        lastSyncAt: at,
        lastError: photoError,
      });
    } catch (err) {
      const failure =
        err instanceof SyncFailure ? err : new SyncFailure('invalid', err instanceof Error ? err.message : String(err));
      await refreshCounts();
      setStatus({ state: failure.state, lastError: failure.message });
      if (failure.retry) {
        failures += 1;
        scheduleRetry();
      }
    }
    return snapshot();
  }

  function syncNow(): Promise<SyncStatus> {
    if (inFlight) return inFlight;
    if (online()) setStatus({ state: 'syncing' });
    const p = run()
      .catch(() => snapshot()) // run() already reports errors; this is belt and braces
      .finally(() => {
        inFlight = null;
        if (rerunRequested) {
          rerunRequested = false;
          if (started) autoSync();
        }
      });
    inFlight = p;
    return p;
  }

  // ---- automatic triggers ------------------------------------------------------------

  /** Automatic sync: respects backoff, coalesces with an in-flight run. */
  function autoSync(): void {
    if (!started || retryTimer !== null) return;
    if (inFlight) {
      rerunRequested = true;
      return;
    }
    void syncNow();
  }

  function clearRetry(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleRetry(): void {
    clearRetry();
    if (!started) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      autoSync();
    }, backoffDelay(failures));
  }

  const onOnline = (): void => {
    clearRetry();
    autoSync();
  };
  const onOffline = (): void => {
    if (!inFlight) setStatus({ state: 'offline' });
  };
  const onVisibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') autoSync();
  };
  const onWrite = (): void => {
    void refreshCounts();
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      autoSync();
    }, debounceMs);
  };

  function start(): void {
    if (started) return;
    started = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    localWrites.addEventListener('write', onWrite);
    intervalTimer = setInterval(autoSync, intervalMs);
    autoSync();
  }

  function stop(): void {
    if (!started) return;
    started = false;
    rerunRequested = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    localWrites.removeEventListener('write', onWrite);
    if (intervalTimer !== null) clearInterval(intervalTimer);
    intervalTimer = null;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = null;
    clearRetry();
  }

  async function retryFailed(): Promise<SyncStatus> {
    try {
      await db.outbox
        .where('status')
        .equals('failed')
        .modify((e) => {
          e.status = 'pending';
          delete e.lastError;
        });
    } catch {
      // fall through: syncNow reports the state
    }
    if (inFlight) await inFlight;
    return syncNow();
  }

  return {
    syncNow,
    start,
    stop,
    getStatus: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },
    retryFailed,
  };
}
