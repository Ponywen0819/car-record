import type { Vehicle } from '@car-record/shared';

/** The stored vehicle if it is still active, else the oldest active vehicle. */
export function pickCurrentVehicle(vehicles: Vehicle[], storedId: string | null): Vehicle | undefined {
  const active = vehicles.filter((v) => v.deletedAt === undefined);
  const stored = storedId ? active.find((v) => v.id === storedId) : undefined;
  if (stored) return stored;
  return [...active].sort((a, b) => a.createdAt - b.createdAt)[0];
}
