import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const nonNeg = z.number().finite().nonnegative();
const positive = z.number().finite().positive();
const positiveInt = z.number().int().positive();

export const FUEL_TYPES = ['gasoline', 'diesel', 'hybrid', 'ev'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const MAINTENANCE_KINDS = ['scheduled', 'repair', 'diy'] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export const EXPENSE_CATEGORY_KEYS = [
  'tax', 'fuel_fee', 'insurance', 'parking', 'toll', 'wash', 'fine', 'loan', 'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORY_KEYS)[number];

export const DEADLINE_KIND_KEYS = ['insurance', 'inspection', 'license', 'tax', 'fuel_fee', 'other'] as const;
export type DeadlineKind = (typeof DEADLINE_KIND_KEYS)[number];

// ---------------------------------------------------------------------------
// Sync metadata shared by every record
// ---------------------------------------------------------------------------

/**
 * Every synced record carries these fields.
 * - id: UUID v7 generated on the client.
 * - createdAt / updatedAt: client epoch ms.
 * - deletedAt: soft delete. Deleting/restoring is just an upsert with/without deletedAt.
 * - rev: assigned by the server on every applied change; clients never set it meaningfully.
 */
export const baseRecordSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  deletedAt: z.number().int().optional(),
  rev: z.number().int().optional(),
});

const vehicleScoped = baseRecordSchema.extend({ vehicleId: z.string().min(1) });

const entryCommon = vehicleScoped.extend({
  date: isoDateSchema,
  cost: nonNeg.optional(),
  note: z.string().optional(),
  photoIds: z.array(z.string().min(1)).optional(),
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const vehicleSchema = baseRecordSchema.extend({
  name: z.string().min(1),
  plate: z.string().optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  fuelType: z.enum(FUEL_TYPES),
  vin: z.string().optional(),
  purchaseDate: isoDateSchema.optional(),
  purchaseOdometer: nonNeg.optional(),
  purchasePrice: nonNeg.optional(),
});

export const maintenanceItemSchema = z.object({
  itemKey: z.string().min(1),
  cost: nonNeg.optional(),
});

export const maintenanceRecordSchema = entryCommon.extend({
  odometer: nonNeg,
  kind: z.enum(MAINTENANCE_KINDS),
  shop: z.string().optional(),
  items: z.array(maintenanceItemSchema).min(1),
});

export const fuelRecordSchema = entryCommon.extend({
  odometer: nonNeg,
  /** Litres, or kWh for EVs. */
  amount: positive,
  unitPrice: nonNeg.optional(),
  isFull: z.boolean(),
  station: z.string().optional(),
  /** e.g. '92' | '95' | '98' | 'diesel' — free text so EV chargers etc. also fit. */
  grade: z.string().optional(),
});

export const expenseRecordSchema = entryCommon.extend({
  odometer: nonNeg.optional(),
  category: z.enum(EXPENSE_CATEGORY_KEYS),
  cost: nonNeg,
  recurring: z.object({ everyMonths: positiveInt }).optional(),
});

export const reminderRuleSchema = vehicleScoped
  .extend({
    itemKey: z.string().min(1),
    label: z.string().min(1),
    everyKm: positive.optional(),
    everyMonths: positiveInt.optional(),
    enabled: z.boolean(),
    /** Snooze: the reminder is treated as not due until these are reached. */
    snoozeUntilDate: isoDateSchema.optional(),
    snoozeUntilOdometer: nonNeg.optional(),
  })
  .refine((r) => r.everyKm !== undefined || r.everyMonths !== undefined, {
    message: 'everyKm or everyMonths is required',
    path: ['everyKm'],
  });

export const deadlineSchema = vehicleScoped.extend({
  kind: z.enum(DEADLINE_KIND_KEYS),
  label: z.string().min(1),
  dueDate: isoDateSchema,
  remindDaysBefore: z.number().int().nonnegative(),
  /** When set, completing the deadline rolls dueDate forward by this many months. */
  repeatEveryMonths: positiveInt.optional(),
  note: z.string().optional(),
});

export type Vehicle = z.infer<typeof vehicleSchema>;
export type MaintenanceItem = z.infer<typeof maintenanceItemSchema>;
export type MaintenanceRecord = z.infer<typeof maintenanceRecordSchema>;
export type FuelRecord = z.infer<typeof fuelRecordSchema>;
export type ExpenseRecord = z.infer<typeof expenseRecordSchema>;
export type ReminderRule = z.infer<typeof reminderRuleSchema>;
export type Deadline = z.infer<typeof deadlineSchema>;
export type BaseRecord = z.infer<typeof baseRecordSchema>;

export const TABLES = ['vehicles', 'maintenance', 'fuel', 'expenses', 'reminderRules', 'deadlines'] as const;
export type TableName = (typeof TABLES)[number];

export const recordSchemas = {
  vehicles: vehicleSchema,
  maintenance: maintenanceRecordSchema,
  fuel: fuelRecordSchema,
  expenses: expenseRecordSchema,
  reminderRules: reminderRuleSchema,
  deadlines: deadlineSchema,
} as const satisfies Record<TableName, z.ZodType>;

export interface TableRecordMap {
  vehicles: Vehicle;
  maintenance: MaintenanceRecord;
  fuel: FuelRecord;
  expenses: ExpenseRecord;
  reminderRules: ReminderRule;
  deadlines: Deadline;
}
export type AnyRecord = TableRecordMap[TableName];

// ---------------------------------------------------------------------------
// Sync protocol (see SPEC.md §4.5)
// ---------------------------------------------------------------------------

export const PUSH_MAX_MUTATIONS = 500;
export const PULL_DEFAULT_LIMIT = 500;
export const PULL_MAX_LIMIT = 1000;

const mutationVariants = TABLES.map((t) =>
  z.object({ mutationId: z.string().min(1), table: z.literal(t), record: recordSchemas[t] }),
);

/** A mutation is always an upsert of the full record (deletes are upserts with deletedAt). */
export const mutationSchema = z.discriminatedUnion(
  'table',
  mutationVariants as unknown as [(typeof mutationVariants)[number], ...(typeof mutationVariants)[number][]],
);
export type Mutation = { [T in TableName]: { mutationId: string; table: T; record: TableRecordMap[T] } }[TableName];

export const pushRequestSchema = z.object({
  mutations: z.array(mutationSchema).max(PUSH_MAX_MUTATIONS),
});
export type PushRequest = { mutations: Mutation[] };

export const PUSH_STATUSES = ['applied', 'duplicate', 'rejected'] as const;
export const pushResultSchema = z.object({
  mutationId: z.string(),
  status: z.enum(PUSH_STATUSES),
  /** Server revision of the record after this mutation (applied / duplicate). */
  rev: z.number().int().optional(),
  error: z.string().optional(),
});
export type PushResult = z.infer<typeof pushResultSchema>;

export const pushResponseSchema = z.object({ results: z.array(pushResultSchema) });
export type PushResponse = z.infer<typeof pushResponseSchema>;

const changeVariants = TABLES.map((t) => z.object({ table: z.literal(t), record: recordSchemas[t] }));
export const changeSchema = z.discriminatedUnion(
  'table',
  changeVariants as unknown as [(typeof changeVariants)[number], ...(typeof changeVariants)[number][]],
);
export type Change = { [T in TableName]: { table: T; record: TableRecordMap[T] } }[TableName];

export const pullResponseSchema = z.object({
  changes: z.array(changeSchema),
  /** Highest rev included in `changes` (or the request's `since` if empty). Pass back as `since`. */
  cursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type PullResponse = { changes: Change[]; cursor: number; hasMore: boolean };
