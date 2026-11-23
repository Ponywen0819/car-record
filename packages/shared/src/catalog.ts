import type { DeadlineKind, ExpenseCategory, FuelType, MaintenanceKind } from './schemas';

export interface MaintenanceItemDef {
  key: string;
  label: string;
  defaultEveryKm?: number;
  defaultEveryMonths?: number;
  /** Fuel types this item does not apply to. */
  notFor?: FuelType[];
}

export const MAINTENANCE_ITEMS: readonly MaintenanceItemDef[] = [
  { key: 'engine_oil', label: '機油', defaultEveryKm: 5000, defaultEveryMonths: 6, notFor: ['ev'] },
  { key: 'oil_filter', label: '機油芯', defaultEveryKm: 10000, defaultEveryMonths: 12, notFor: ['ev'] },
  { key: 'air_filter', label: '空氣濾網', defaultEveryKm: 20000, defaultEveryMonths: 12, notFor: ['ev'] },
  { key: 'cabin_filter', label: '冷氣濾網', defaultEveryKm: 10000, defaultEveryMonths: 12 },
  { key: 'brake_fluid', label: '煞車油', defaultEveryKm: 40000, defaultEveryMonths: 24 },
  { key: 'transmission_fluid', label: '變速箱油', defaultEveryKm: 40000, notFor: ['ev'] },
  { key: 'coolant', label: '水箱水', defaultEveryKm: 40000, defaultEveryMonths: 24 },
  { key: 'spark_plugs', label: '火星塞', defaultEveryKm: 40000, notFor: ['ev', 'diesel'] },
  { key: 'tire_rotation', label: '輪胎換位', defaultEveryKm: 10000 },
  { key: 'tires', label: '輪胎' },
  { key: 'battery', label: '電瓶', defaultEveryMonths: 24 },
  { key: 'brake_pads', label: '煞車來令片' },
  { key: 'wipers', label: '雨刷', defaultEveryMonths: 12 },
  { key: 'alignment', label: '四輪定位' },
  { key: 'other', label: '其他' },
];

/** Reminder rules created for a new vehicle (SPEC §2.5). */
export const DEFAULT_REMINDER_ITEM_KEYS = [
  'engine_oil', 'oil_filter', 'air_filter', 'cabin_filter', 'brake_fluid', 'tire_rotation', 'battery',
] as const;

export function maintenanceItemsFor(fuelType: FuelType): MaintenanceItemDef[] {
  return MAINTENANCE_ITEMS.filter((i) => !i.notFor?.includes(fuelType));
}

export function maintenanceItemLabel(key: string): string {
  return MAINTENANCE_ITEMS.find((i) => i.key === key)?.label ?? key;
}

export const MAINTENANCE_KIND_LABELS: Record<MaintenanceKind, string> = {
  scheduled: '定期保養',
  repair: '故障維修',
  diy: '自行 DIY',
};

export const FUEL_TYPE_LABELS: Record<FuelType, string> = {
  gasoline: '汽油',
  diesel: '柴油',
  hybrid: '油電',
  ev: '純電',
};

export const EXPENSE_CATEGORIES: readonly { key: ExpenseCategory; label: string }[] = [
  { key: 'tax', label: '牌照稅' },
  { key: 'fuel_fee', label: '燃料費' },
  { key: 'insurance', label: '保險' },
  { key: 'parking', label: '停車' },
  { key: 'toll', label: '過路費' },
  { key: 'wash', label: '洗車' },
  { key: 'fine', label: '罰單' },
  { key: 'loan', label: '貸款' },
  { key: 'other', label: '其他' },
];

export const DEADLINE_KINDS: readonly { key: DeadlineKind; label: string }[] = [
  { key: 'insurance', label: '保險' },
  { key: 'inspection', label: '定期驗車' },
  { key: 'license', label: '駕照' },
  { key: 'tax', label: '牌照稅' },
  { key: 'fuel_fee', label: '燃料費' },
  { key: 'other', label: '其他' },
];
