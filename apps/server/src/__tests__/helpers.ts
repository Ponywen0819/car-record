import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach } from 'vitest';
import { createApp, type CreateAppOptions, type ServerApp } from '../app';
import { closeSharedPglite, createTestDatabase, type TestDatabase } from '../testing/testDatabase';

const cleanups: (() => unknown)[] = [];

afterEach(async () => {
  while (cleanups.length) {
    try {
      await cleanups.pop()!();
    } catch {
      // ignore cleanup errors (e.g. Windows file locks)
    }
  }
});

afterAll(closeSharedPglite);

export function tmpDir(prefix = 'car-record-server-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.unshift(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A fresh, migrated test schema; dropped automatically after the test. */
export async function testDatabase(): Promise<TestDatabase> {
  const testDb = await createTestDatabase();
  cleanups.unshift(() => testDb.dispose());
  return testDb;
}

export interface TestApp extends ServerApp {
  testDb: TestDatabase;
  /** Start a second app on the same database schema (a server restart). */
  reopen(opts?: Partial<Omit<CreateAppOptions, 'database'>>): Promise<TestApp>;
}

type MakeAppOptions = Partial<Omit<CreateAppOptions, 'database'>> & { testDb?: TestDatabase };

/** Create an app on a fresh database schema; closed automatically after each test. */
export async function makeApp(opts: MakeAppOptions = {}): Promise<TestApp> {
  const { testDb: givenDb, ...appOpts } = opts;
  const testDb = givenDb ?? (await testDatabase());
  const server = await createApp({ ...appOpts, database: await testDb.open() });
  cleanups.push(() => server.close());
  return {
    ...server,
    testDb,
    reopen: (more = {}) => makeApp({ ...appOpts, ...more, testDb }),
  };
}

let counter = 0;
export function vehicle(overrides: Record<string, unknown> = {}) {
  counter++;
  return {
    id: `veh-${counter}`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    name: `Car ${counter}`,
    fuelType: 'gasoline',
    ...overrides,
  };
}

export function fuel(overrides: Record<string, unknown> = {}) {
  counter++;
  return {
    id: `fuel-${counter}`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    vehicleId: 'veh-x',
    date: '2026-01-02',
    odometer: 12345,
    amount: 40,
    isFull: true,
    ...overrides,
  };
}

export function mutation(table: string, record: Record<string, unknown>, mutationId?: string) {
  counter++;
  return { mutationId: mutationId ?? `m-${counter}`, table, record };
}

export const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

export async function push(app: ServerApp['app'], mutations: unknown[], headers: Record<string, string> = {}) {
  const res = await app.request('/api/sync/push', json({ mutations }, headers));
  return { res, body: (await res.json()) as any };
}

export async function pull(app: ServerApp['app'], query = '', headers: Record<string, string> = {}) {
  const res = await app.request(`/api/sync/pull${query}`, { headers });
  return { res, body: (await res.json()) as any };
}
