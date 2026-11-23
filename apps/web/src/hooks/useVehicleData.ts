import { useLiveQuery } from 'dexie-react-hooks';
import type {
  Deadline,
  ExpenseRecord,
  FuelRecord,
  MaintenanceRecord,
  ReminderRule,
  Vehicle,
} from '@car-record/shared';
import type { CarDB } from '../db/db';

export interface VehicleData {
  vehicle: Vehicle;
  fuel: FuelRecord[];
  maintenance: MaintenanceRecord[];
  expenses: ExpenseRecord[];
  reminderRules: ReminderRule[];
  deadlines: Deadline[];
}

const active = <T extends { deletedAt?: number }>(rows: T[]): T[] => rows.filter((r) => r.deletedAt === undefined);

/** Active vehicles (live). undefined while loading. */
export function useVehicles(db: CarDB): Vehicle[] | undefined {
  return useLiveQuery(async () => active(await db.vehicles.toArray()), [db]);
}

export async function loadVehicleData(db: CarDB, vehicleId: string): Promise<VehicleData | null> {
  const [vehicle, fuel, maintenance, expenses, reminderRules, deadlines] = await Promise.all([
    db.vehicles.get(vehicleId),
    db.fuel.where('vehicleId').equals(vehicleId).toArray(),
    db.maintenance.where('vehicleId').equals(vehicleId).toArray(),
    db.expenses.where('vehicleId').equals(vehicleId).toArray(),
    db.reminderRules.where('vehicleId').equals(vehicleId).toArray(),
    db.deadlines.where('vehicleId').equals(vehicleId).toArray(),
  ]);
  if (!vehicle || vehicle.deletedAt !== undefined) return null;
  return {
    vehicle,
    fuel: active(fuel),
    maintenance: active(maintenance),
    expenses: active(expenses),
    reminderRules: active(reminderRules),
    deadlines: active(deadlines),
  };
}

/**
 * All active records of one vehicle (live). undefined while loading, null when there is
 * no such vehicle.
 */
export function useVehicleData(db: CarDB, vehicleId: string | undefined): VehicleData | null | undefined {
  return useLiveQuery(async () => (vehicleId ? loadVehicleData(db, vehicleId) : null), [db, vehicleId]);
}
