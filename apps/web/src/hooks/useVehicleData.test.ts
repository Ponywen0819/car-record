import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createDb, type CarDB } from '../db/db';
import { useVehicleData, useVehicles } from './useVehicleData';

let db: CarDB;
let counter = 0;

afterEach(async () => {
  db?.close();
});

async function seed() {
  db = createDb(`test-vehicle-data-${Date.now()}-${counter++}`);
  await db.vehicles.bulkPut([
    { id: 'v1', name: '小白', fuelType: 'gasoline', createdAt: 1, updatedAt: 1 },
    { id: 'v2', name: '舊車', fuelType: 'diesel', createdAt: 2, updatedAt: 2, deletedAt: 3 },
  ]);
  await db.fuel.bulkPut([
    { id: 'f1', vehicleId: 'v1', date: '2026-11-01', odometer: 1000, amount: 30, isFull: true, createdAt: 1, updatedAt: 1 },
    { id: 'f2', vehicleId: 'v1', date: '2026-11-02', odometer: 1200, amount: 30, isFull: true, createdAt: 1, updatedAt: 1, deletedAt: 5 },
    { id: 'f3', vehicleId: 'v2', date: '2026-11-03', odometer: 1, amount: 3, isFull: true, createdAt: 1, updatedAt: 1 },
  ]);
  await db.reminderRules.put({ id: 'r1', vehicleId: 'v1', itemKey: 'engine_oil', label: '機油', everyKm: 5000, enabled: true, createdAt: 1, updatedAt: 1 });
}

describe('useVehicles', () => {
  it('lists active vehicles', async () => {
    await seed();
    const { result } = renderHook(() => useVehicles(db));
    await waitFor(() => expect(result.current?.map((v) => v.id)).toEqual(['v1']));
  });
});

describe('useVehicleData', () => {
  it('loads active records of one vehicle', async () => {
    await seed();
    const { result } = renderHook(() => useVehicleData(db, 'v1'));
    await waitFor(() => expect(result.current).toBeTruthy());
    expect(result.current!.vehicle.name).toBe('小白');
    expect(result.current!.fuel.map((f) => f.id)).toEqual(['f1']);
    expect(result.current!.reminderRules).toHaveLength(1);
    expect(result.current!.maintenance).toEqual([]);
  });

  it('is null for an unknown / missing vehicle', async () => {
    await seed();
    const { result } = renderHook(() => useVehicleData(db, undefined));
    // undefined while loading, then null
    await waitFor(() => expect(result.current).toBeNull());
  });
});
