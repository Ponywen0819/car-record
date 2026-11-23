/**
 * start() / stop(): automatic sync triggers, debounce and backoff, driven with fake timers.
 * Only timer functions (and Date) are faked; fake-indexeddb runs on setImmediate, which stays real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveRecord } from '../../db/repository';
import { vehicleDraft } from '../../db/__tests__/fixtures';
import { makeHarness, settle, type Harness } from './helpers';

const INTERVAL = 60_000;
const DEBOUNCE = 2_000;

let h: Harness;
let visibility: DocumentVisibilityState;

function pulls(): number {
  return h.server.requestsTo('/api/sync/pull').length;
}

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Advance fake time and let any sync it triggered finish. */
async function advance(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await settle(h.engine);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  h = makeHarness({ intervalMs: INTERVAL, debounceMs: DEBOUNCE });
});

afterEach(async () => {
  await h.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('start()', () => {
  it('syncs immediately on start', async () => {
    h.engine.start();
    await settle(h.engine);
    expect(pulls()).toBe(1);
    expect(h.engine.getStatus().state).toBe('idle');
  });

  it('is idempotent (calling start twice does not double the triggers)', async () => {
    h.engine.start();
    h.engine.start();
    await settle(h.engine);
    await advance(INTERVAL);
    expect(pulls()).toBe(2);
  });

  it("syncs on window 'online'", async () => {
    h.engine.start();
    await settle(h.engine);
    window.dispatchEvent(new Event('online'));
    await settle(h.engine);
    expect(pulls()).toBe(2);
  });

  it("reports 'offline' on window 'offline' without fetching", async () => {
    h.engine.start();
    await settle(h.engine);
    h.net.online = false;
    window.dispatchEvent(new Event('offline'));
    await settle(h.engine);
    expect(h.engine.getStatus().state).toBe('offline');
    expect(pulls()).toBe(1);
  });

  it('syncs when the document becomes visible, not when hidden', async () => {
    h.engine.start();
    await settle(h.engine);
    setVisibility('hidden');
    await settle(h.engine);
    expect(pulls()).toBe(1);
    setVisibility('visible');
    await settle(h.engine);
    expect(pulls()).toBe(2);
  });

  it('syncs every intervalMs', async () => {
    h.engine.start();
    await settle(h.engine);
    await advance(INTERVAL - 1);
    expect(pulls()).toBe(1);
    await advance(1);
    expect(pulls()).toBe(2);
    await advance(INTERVAL);
    expect(pulls()).toBe(3);
  });

  it('defaults to a 5 minute interval and 2 s debounce', async () => {
    await h.dispose();
    h = makeHarness();
    h.engine.start();
    await settle(h.engine);
    await advance(5 * 60_000 - 1);
    expect(pulls()).toBe(1);
    await advance(1);
    expect(pulls()).toBe(2);

    await saveRecord(h.db, 'vehicles', vehicleDraft(), 1);
    await advance(1_999);
    expect(h.server.requestsTo('/api/sync/push')).toHaveLength(0);
    await advance(1);
    expect(h.server.requestsTo('/api/sync/push')).toHaveLength(1);
  });

  it('debounces local writes: several quick writes → one sync after debounceMs', async () => {
    h.engine.start();
    await settle(h.engine);
    await saveRecord(h.db, 'vehicles', vehicleDraft({ name: 'a' }), 1);
    await advance(1_000);
    await saveRecord(h.db, 'vehicles', vehicleDraft({ name: 'b' }), 2);
    await advance(1_000);
    await saveRecord(h.db, 'vehicles', vehicleDraft({ name: 'c' }), 3);
    expect(h.server.requestsTo('/api/sync/push')).toHaveLength(0);

    await advance(DEBOUNCE);
    const pushes = h.server.requestsTo('/api/sync/push');
    expect(pushes).toHaveLength(1);
    expect((pushes[0]!.body as { mutations: unknown[] }).mutations).toHaveLength(3);
    expect(h.engine.getStatus().pending).toBe(0);
  });

  it('updates the pending count right after a local write (before the debounced sync)', async () => {
    h.engine.start();
    await settle(h.engine);
    await saveRecord(h.db, 'vehicles', vehicleDraft(), 1);
    await settle(h.engine);
    expect(h.engine.getStatus().pending).toBe(1);
  });

  it('a write during an in-flight sync is synced right after that run', async () => {
    h.engine.start();
    // The initial sync is in flight; write now.
    await saveRecord(h.db, 'vehicles', vehicleDraft(), 1);
    await advance(DEBOUNCE);
    await settle(h.engine);
    expect(h.server.applied).toHaveLength(1);
    expect(h.engine.getStatus().pending).toBe(0);
  });
});

describe('stop()', () => {
  it('removes listeners and timers', async () => {
    h.engine.start();
    await settle(h.engine);
    h.engine.stop();

    window.dispatchEvent(new Event('online'));
    setVisibility('hidden');
    setVisibility('visible');
    await saveRecord(h.db, 'vehicles', vehicleDraft(), 1);
    await advance(INTERVAL * 3);

    expect(pulls()).toBe(1);
    expect(h.server.requestsTo('/api/sync/push')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending debounce and backoff retry', async () => {
    h.server.offline = true;
    h.engine.start();
    await settle(h.engine);
    await saveRecord(h.db, 'vehicles', vehicleDraft(), 1);
    h.engine.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('can be started again', async () => {
    h.engine.start();
    await settle(h.engine);
    h.engine.stop();
    h.engine.start();
    await settle(h.engine);
    expect(pulls()).toBe(2);
    await advance(INTERVAL);
    expect(pulls()).toBe(3);
  });
});

describe('backoff', () => {
  it('retries after network errors with exponential backoff: 1s, 2s, 4s …', async () => {
    await saveRecord(h.db, 'vehicles', vehicleDraft(), 1);
    h.server.offline = true;
    const attempts = () => h.server.requestsTo('/api/sync/push').length;

    h.engine.start();
    await settle(h.engine);
    expect(attempts()).toBe(1);
    expect(h.engine.getStatus().state).toBe('offline');

    await advance(999);
    expect(attempts()).toBe(1);
    await advance(1);
    expect(attempts()).toBe(2);

    await advance(1_999);
    expect(attempts()).toBe(2);
    await advance(1);
    expect(attempts()).toBe(3);

    await advance(3_999);
    expect(attempts()).toBe(3);
    await advance(1);
    expect(attempts()).toBe(4);
    expect((await h.db.outbox.toArray())[0]).toMatchObject({ status: 'pending', attempts: 4 });

    // Server reachable again → next retry (8s) succeeds and backoff resets.
    h.server.offline = false;
    await advance(8_000);
    expect(attempts()).toBe(5);
    expect(h.engine.getStatus()).toMatchObject({ state: 'idle', pending: 0 });
    expect(await h.db.outbox.count()).toBe(0);
  });

  it('backs off on 5xx too', async () => {
    h.server.serverError = 502;
    h.engine.start();
    await settle(h.engine);
    expect(pulls()).toBe(1);
    expect(h.engine.getStatus().state).toBe('error');
    await advance(999);
    expect(pulls()).toBe(1);
    await advance(1);
    expect(pulls()).toBe(2);
  });

  it('interval and debounced writes do not bypass the backoff', async () => {
    await h.dispose();
    h = makeHarness({ intervalMs: 1_500, debounceMs: 100 });
    h.server.offline = true;
    h.engine.start();
    await settle(h.engine);
    expect(h.server.requests).toHaveLength(1);
    await advance(500); // in backoff (1s), past nothing
    await saveRecord(h.db, 'vehicles', vehicleDraft(), 1);
    await advance(200); // debounce fired during backoff → skipped
    expect(h.server.requests).toHaveLength(1);
    await advance(300); // backoff retry at 1s
    expect(h.server.requests).toHaveLength(2);
    // next backoff is 2s; the 1.5s interval tick at t=1500 / 3000 must not sneak in
    await advance(1_999);
    expect(h.server.requests).toHaveLength(2);
    await advance(1);
    expect(h.server.requests).toHaveLength(3);
  });

  it("an 'online' event retries immediately, ignoring the backoff", async () => {
    h.server.offline = true;
    h.engine.start();
    await settle(h.engine);
    expect(pulls()).toBe(1);
    h.server.offline = false;
    window.dispatchEvent(new Event('online'));
    await settle(h.engine);
    expect(pulls()).toBe(2);
    expect(h.engine.getStatus().state).toBe('idle');
  });

  it('a manual syncNow() is always attempted, even during backoff', async () => {
    h.server.offline = true;
    h.engine.start();
    await settle(h.engine);
    await h.engine.syncNow();
    expect(h.server.requests).toHaveLength(2);
  });

  it('does not back off for rejected mutations', async () => {
    await saveRecord(h.db, 'vehicles', vehicleDraft(), 1);
    h.server.rejectMutation = () => 'nope';
    h.engine.start();
    await settle(h.engine);
    expect(h.engine.getStatus()).toMatchObject({ state: 'idle', failed: 1 });
    await advance(10_000);
    expect(pulls()).toBe(1); // no retry scheduled; next sync is the interval
  });
});
