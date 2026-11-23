import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vehicle } from '@car-record/shared';
import * as domain from '../../domain';
import type { VehicleData } from '../../hooks/useVehicleData';
import { buildStats, categoryLabel, swipeDirection } from './statsModel';

vi.mock('../../domain', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  lastNMonths: vi.fn((_today: string, n: number) => (n === 6 ? ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'] : [])),
  collectReadings: vi.fn(() => []),
  computeFuelEconomy: vi.fn(() => [
    { recordId: 'old', date: '2026-01-10', odometer: 1, distanceKm: 1, amount: 1, kmPerUnit: 9 },
    { recordId: 'a', date: '2026-07-10', odometer: 2, distanceKm: 500, amount: 40, kmPerUnit: 12.5 },
    { recordId: 'b', date: '2026-11-01', odometer: 3, distanceKm: 560, amount: 40, kmPerUnit: 14 },
  ]),
  averageEconomy: vi.fn(() => 13.25),
  collectCosts: vi.fn(() => [{ date: '2026-07-01', category: 'fuel', cost: 1000 }]),
  monthlyCosts: vi.fn((_e: unknown, months: string[]) => months.map((m) => ({ month: m, total: 0, byCategory: {} }))),
  costByCategory: vi.fn(() => [
    { category: 'fuel', total: 1000 },
    { category: 'tax', total: 500 },
  ]),
  costPerKm: vi.fn(() => 2.5),
  monthlyDistance: vi.fn((_r: unknown, months: string[]) => months.map((m) => ({ month: m, km: 100 }))),
}));

const vehicle: Vehicle = { id: 'v1', name: '小白', fuelType: 'gasoline', createdAt: 1, updatedAt: 1 };
const data: VehicleData = { vehicle, fuel: [], maintenance: [], expenses: [], reminderRules: [], deadlines: [] };

beforeEach(() => vi.clearAllMocks());

describe('buildStats', () => {
  it('limits everything to the selected period', () => {
    const s = buildStats(data, '2026-11-23', 6);
    const range = { from: '2026-06-01', to: '2026-11-23' };
    expect(s.months).toHaveLength(6);
    expect(s.monthLabels[0]).toBe('6月');
    expect(s.economy.map((p) => p.recordId)).toEqual(['a', 'b']);
    expect(s.averageEconomy).toBe(13.25);
    expect(domain.averageEconomy).toHaveBeenCalledWith(s.economy);
    expect(domain.costByCategory).toHaveBeenCalledWith(expect.any(Array), range);
    expect(domain.costPerKm).toHaveBeenCalledWith(expect.any(Array), [], range);
    expect(s.categories).toEqual([
      { category: 'fuel', label: '油錢', total: 1000 },
      { category: 'tax', label: '牌照稅', total: 500 },
    ]);
    expect(s.totalCost).toBe(1500);
    expect(s.costPerKm).toBe(2.5);
    expect(s.totalDistance).toBe(600);
  });
});

describe('categoryLabel', () => {
  it('labels cost categories', () => {
    expect(categoryLabel('fuel', 'gasoline')).toBe('油錢');
    expect(categoryLabel('fuel', 'ev')).toBe('電費');
    expect(categoryLabel('maintenance', 'gasoline')).toBe('保養維修');
    expect(categoryLabel('insurance', 'gasoline')).toBe('保險');
    expect(categoryLabel('weird', 'gasoline')).toBe('weird');
  });
});

describe('swipeDirection', () => {
  it('detects clear horizontal swipes only', () => {
    expect(swipeDirection(-80, 10)).toBe('left');
    expect(swipeDirection(80, 5)).toBe('right');
    expect(swipeDirection(30, 0)).toBeNull();
    expect(swipeDirection(80, 70)).toBeNull();
  });
});
