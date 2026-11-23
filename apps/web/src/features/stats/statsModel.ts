import { EXPENSE_CATEGORIES, type FuelType } from '@car-record/shared';
import {
  averageEconomy,
  collectCosts,
  collectReadings,
  computeFuelEconomy,
  costByCategory,
  costPerKm,
  lastNMonths,
  monthlyCosts,
  monthlyDistance,
  type FuelEconomyPoint,
  type MonthlyCost,
} from '../../domain';
import type { VehicleData } from '../../hooks/useVehicleData';
import { monthLabel } from '../../lib/format';

export type StatsPeriod = 6 | 12;

export interface StatsResult {
  months: string[];
  monthLabels: string[];
  range: { from: string; to: string };
  economy: FuelEconomyPoint[];
  averageEconomy: number | null;
  monthlyCosts: MonthlyCost[];
  /** Category keys present in the period, for stacking (sorted by total desc). */
  categories: { category: string; label: string; total: number }[];
  totalCost: number;
  costPerKm: number | null;
  distance: { month: string; km: number }[];
  totalDistance: number;
}

export function categoryLabel(category: string, fuelType: FuelType): string {
  if (category === 'fuel') return fuelType === 'ev' ? '電費' : '油錢';
  if (category === 'maintenance') return '保養維修';
  return EXPENSE_CATEGORIES.find((c) => c.key === category)?.label ?? category;
}

export function buildStats(data: VehicleData, today: string, period: StatsPeriod): StatsResult {
  const months = lastNMonths(today, period);
  const range = { from: `${months[0] ?? today.slice(0, 7)}-01`, to: today };
  const readings = collectReadings({
    vehicle: data.vehicle,
    fuel: data.fuel,
    maintenance: data.maintenance,
    expenses: data.expenses,
  });
  const economy = computeFuelEconomy(data.fuel).filter((p) => p.date >= range.from && p.date <= range.to);
  const costs = collectCosts({ fuel: data.fuel, maintenance: data.maintenance, expenses: data.expenses });
  const categories = costByCategory(costs, range).map((c) => ({
    ...c,
    label: categoryLabel(c.category, data.vehicle.fuelType),
  }));
  const distance = monthlyDistance(readings, months);
  return {
    months,
    monthLabels: months.map((m) => monthLabel(m, true)),
    range,
    economy,
    averageEconomy: averageEconomy(economy),
    monthlyCosts: monthlyCosts(costs, months),
    categories,
    totalCost: categories.reduce((s, c) => s + c.total, 0),
    costPerKm: costPerKm(costs, readings, range),
    distance,
    totalDistance: distance.reduce((s, d) => s + d.km, 0),
  };
}

/** A deliberate horizontal swipe: ≥ minDistance px and clearly more horizontal than vertical. */
export function swipeDirection(dx: number, dy: number, minDistance = 50): 'left' | 'right' | null {
  if (Math.abs(dx) < minDistance) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'left' : 'right';
}

/** Stable colours per category (work on light and dark backgrounds). */
export const CATEGORY_COLORS: Record<string, string> = {
  fuel: '#1f6feb',
  maintenance: '#f59f00',
  tax: '#8e44ad',
  fuel_fee: '#c2410c',
  insurance: '#16a34a',
  parking: '#0891b2',
  toll: '#64748b',
  wash: '#38bdf8',
  fine: '#dc2626',
  loan: '#a16207',
  other: '#9ca3af',
};
