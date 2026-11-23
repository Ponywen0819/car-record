import type {
  Deadline,
  ExpenseRecord,
  FuelRecord,
  MaintenanceRecord,
  ReminderRule,
  Vehicle,
} from '@car-record/shared';

let seq = 0;
const nextId = (prefix: string) => `${prefix}${++seq}`;

export const VID = 'v1';

export function vehicle(over: Partial<Vehicle> = {}): Vehicle {
  return { id: VID, createdAt: 1, updatedAt: 1, name: '我的車', fuelType: 'gasoline', ...over };
}

export function fuel(over: Partial<FuelRecord> & Pick<FuelRecord, 'date' | 'odometer'>): FuelRecord {
  return {
    id: nextId('f'),
    createdAt: 1,
    updatedAt: 1,
    vehicleId: VID,
    amount: 40,
    isFull: true,
    ...over,
  };
}

export function maint(
  over: Partial<MaintenanceRecord> & Pick<MaintenanceRecord, 'date' | 'odometer'> & { itemKeys?: string[] },
): MaintenanceRecord {
  const { itemKeys, ...rest } = over;
  return {
    id: nextId('m'),
    createdAt: 1,
    updatedAt: 1,
    vehicleId: VID,
    kind: 'scheduled',
    items: (itemKeys ?? ['engine_oil']).map((itemKey) => ({ itemKey })),
    ...rest,
  };
}

export function expense(over: Partial<ExpenseRecord> & Pick<ExpenseRecord, 'date' | 'cost'>): ExpenseRecord {
  return {
    id: nextId('e'),
    createdAt: 1,
    updatedAt: 1,
    vehicleId: VID,
    category: 'parking',
    ...over,
  };
}

export function rule(over: Partial<ReminderRule> = {}): ReminderRule {
  return {
    id: nextId('r'),
    createdAt: 1,
    updatedAt: 1,
    vehicleId: VID,
    itemKey: 'engine_oil',
    label: '機油',
    everyKm: 5000,
    everyMonths: 6,
    enabled: true,
    ...over,
  };
}

export function deadline(over: Partial<Deadline> & Pick<Deadline, 'dueDate'>): Deadline {
  return {
    id: nextId('d'),
    createdAt: 1,
    updatedAt: 1,
    vehicleId: VID,
    kind: 'insurance',
    label: '強制險',
    remindDaysBefore: 30,
    ...over,
  };
}
