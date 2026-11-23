/**
 * Shared test helpers for the db / sync test suites (not a test file itself).
 */
import { Blob as NodeBlob } from 'node:buffer';
import { uuidv7 } from '@car-record/shared';
import { createDb, type CarDB } from '../db';
import type { Draft } from '../repository';

/** A fresh, uniquely named Dexie database. Pair with `disposeDb`. */
export function makeTestDb(): CarDB {
  return createDb(`test-${uuidv7()}`);
}

export async function disposeDb(db: CarDB): Promise<void> {
  db.close();
  await db.delete();
}

/**
 * jsdom's Blob is not structured-cloneable by fake-indexeddb (it comes back as `{}`),
 * so tests use Node's Blob, which is what a real browser Blob behaves like.
 */
export function testBlob(text = 'jpeg-bytes', type = 'image/jpeg'): Blob {
  return new NodeBlob([text], { type }) as unknown as Blob;
}

export function vehicleDraft(overrides: Partial<Draft<'vehicles'>> = {}): Draft<'vehicles'> {
  return { name: 'My Car', fuelType: 'gasoline', ...overrides };
}

export function fuelDraft(vehicleId: string, overrides: Partial<Draft<'fuel'>> = {}): Draft<'fuel'> {
  return { vehicleId, date: '2026-01-10', odometer: 1000, amount: 30, isFull: true, cost: 900, ...overrides };
}

export function expenseDraft(vehicleId: string, overrides: Partial<Draft<'expenses'>> = {}): Draft<'expenses'> {
  return { vehicleId, date: '2026-01-10', category: 'parking', cost: 50, ...overrides };
}

export function reminderDraft(vehicleId: string, overrides: Partial<Draft<'reminderRules'>> = {}): Draft<'reminderRules'> {
  return { vehicleId, itemKey: 'engine_oil', label: 'Oil', everyKm: 5000, enabled: true, ...overrides } as Draft<'reminderRules'>;
}
