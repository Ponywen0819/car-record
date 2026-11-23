import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { createApp, type CreateAppOptions, type ServerApp } from '../app';

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length) {
    try {
      cleanups.pop()!();
    } catch {
      // ignore cleanup errors (e.g. Windows file locks)
    }
  }
});

export function tmpDir(prefix = 'car-record-server-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.unshift(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Create an app on a fresh temp dataDir (or the given one); closed automatically after each test. */
export function makeApp(opts: Partial<CreateAppOptions> = {}): ServerApp & { dataDir: string } {
  const dataDir = opts.dataDir ?? tmpDir();
  const server = createApp({ ...opts, dataDir });
  cleanups.push(() => server.close());
  return { ...server, dataDir };
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
