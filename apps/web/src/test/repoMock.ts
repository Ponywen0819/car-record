/**
 * vi.fn() stand-in for src/db/repository. Use with
 *   vi.mock('../../db/repository', () => import('../../test/repoMock'));
 * and `vi.clearAllMocks()` in beforeEach (keeps the implementations).
 */
import { vi } from 'vitest';
import type { CarDB } from '../db/db';

let n = 0;

export const localWrites: EventTarget = new EventTarget();

export const saveRecord = vi.fn(
  async (_db: CarDB, _table: string, draft: Record<string, unknown>, now = 1000): Promise<any> => ({
    ...draft,
    id: (draft.id as string | undefined) ?? `new-${++n}`,
    createdAt: (draft.createdAt as number | undefined) ?? now,
    updatedAt: now,
  }),
);

export const softDelete = vi.fn(async (_db: CarDB, _table: string, id: string, now = 1000): Promise<any> => ({
  id,
  deletedAt: now,
}));

export const restoreRecord = vi.fn(async (_db: CarDB, _table: string, id: string): Promise<any> => ({ id }));

export const getRecord = vi.fn(async (): Promise<any> => undefined);

export const listActive = vi.fn(async (): Promise<any[]> => []);

export const importRecords = vi.fn(async (_db: CarDB, tables: Record<string, unknown[] | undefined>) =>
  Object.values(tables).reduce((sum, rows) => sum + (rows?.length ?? 0), 0),
);
