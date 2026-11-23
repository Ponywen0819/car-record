import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deadline, ReminderRule, Vehicle } from '@car-record/shared';
import * as domain from '../../domain';
import type { DeadlineStatus, ReminderStatus } from '../../domain';
import { badgeCount, deadlineSummary, deriveVehicleState, economyUnit, reminderSummary } from './dashboardModel';
import type { VehicleData } from '../../hooks/useVehicleData';

vi.mock('../../domain', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  collectReadings: vi.fn(() => [{ date: '2026-11-01', odometer: 52000, source: 'fuel' }]),
  estimateOdometer: vi.fn(() => ({ value: 52340, dailyKm: 15.5, isEstimated: true, last: { date: '2026-11-01', odometer: 52000, source: 'fuel' } })),
  computeFuelEconomy: vi.fn(() => [
    { recordId: 'a', date: '2026-10-01', odometer: 51000, distanceKm: 500, amount: 40, kmPerUnit: 12.5 },
    { recordId: 'b', date: '2026-11-01', odometer: 52000, distanceKm: 560, amount: 40, kmPerUnit: 14 },
  ]),
  averageEconomy: vi.fn(() => 13.2),
  detectEconomyAnomaly: vi.fn(() => null),
  computeAllReminders: vi.fn(() => []),
  computeAllDeadlines: vi.fn(() => []),
}));

const vehicle: Vehicle = { id: 'v1', name: '小白', fuelType: 'gasoline', createdAt: 1, updatedAt: 1 };
const data: VehicleData = { vehicle, fuel: [], maintenance: [], expenses: [], reminderRules: [], deadlines: [] };

beforeEach(() => vi.clearAllMocks());

describe('deriveVehicleState', () => {
  it('wires the domain functions together', () => {
    const state = deriveVehicleState(data, '2026-11-23');
    expect(domain.collectReadings).toHaveBeenCalledWith({ vehicle, fuel: [], maintenance: [], expenses: [] });
    expect(state.estimate?.value).toBe(52340);
    expect(state.latestEconomy?.recordId).toBe('b');
    expect(state.averageEconomy).toBe(13.2);
    expect(domain.computeAllReminders).toHaveBeenCalledWith([], {
      maintenance: [],
      currentOdometer: 52340,
      dailyKm: 15.5,
      today: '2026-11-23',
      vehicle,
    });
    expect(domain.computeAllDeadlines).toHaveBeenCalledWith([], '2026-11-23');
  });

  it('copes with no readings', () => {
    vi.mocked(domain.estimateOdometer).mockReturnValueOnce(null);
    vi.mocked(domain.computeFuelEconomy).mockReturnValueOnce([]);
    const state = deriveVehicleState(data, '2026-11-23');
    expect(state.estimate).toBeNull();
    expect(state.latestEconomy).toBeNull();
    expect(vi.mocked(domain.computeAllReminders).mock.calls[0]![1]).toMatchObject({ currentOdometer: null, dailyKm: null });
  });
});

const rule: ReminderRule = { id: 'r', vehicleId: 'v1', itemKey: 'engine_oil', label: '機油', everyKm: 5000, enabled: true, createdAt: 1, updatedAt: 1 };
const rs = (p: Partial<ReminderStatus>): ReminderStatus => ({ rule, level: 'ok', progress: 0.2, snoozed: false, ...p });
const deadline: Deadline = { id: 'd', vehicleId: 'v1', kind: 'insurance', label: '保險', dueDate: '2026-12-01', remindDaysBefore: 30, createdAt: 1, updatedAt: 1 };
const ds = (p: Partial<DeadlineStatus>): DeadlineStatus => ({ deadline, remainingDays: 8, level: 'soon', ...p });

describe('badgeCount', () => {
  it('counts overdue and soon reminders and deadlines', () => {
    expect(
      badgeCount({
        reminders: [rs({ level: 'overdue' }), rs({ level: 'soon' }), rs({ level: 'unknown' }), rs({ level: 'ok' })],
        deadlines: [ds({ level: 'soon' }), ds({ level: 'ok' })],
      }),
    ).toBe(3);
  });
});

describe('reminderSummary', () => {
  it('shows remaining km and days', () => {
    expect(reminderSummary(rs({ remainingKm: 320, remainingDays: 45 }))).toBe('剩 320 km／45 天');
    expect(reminderSummary(rs({ remainingKm: 1200 }))).toBe('剩 1,200 km');
  });
  it('shows overdue amounts', () => {
    expect(reminderSummary(rs({ level: 'overdue', remainingKm: -150, remainingDays: -3 }))).toBe('超過 150 km／逾期 3 天');
  });
  it('explains unknown and snoozed reminders', () => {
    expect(reminderSummary(rs({ level: 'unknown' }))).toBe('尚無紀錄，請登錄上次保養');
    expect(reminderSummary(rs({ snoozed: true, remainingKm: 100 }))).toBe('已延後 · 剩 100 km');
  });
});

describe('deadlineSummary', () => {
  it('describes remaining days', () => {
    expect(deadlineSummary(ds({ remainingDays: 8 }))).toBe('剩 8 天（2026-12-01）');
    expect(deadlineSummary(ds({ remainingDays: 0 }))).toBe('今天到期');
    expect(deadlineSummary(ds({ remainingDays: -2, level: 'overdue' }))).toBe('已逾期 2 天');
  });
});

describe('economyUnit', () => {
  it('depends on fuel type', () => {
    expect(economyUnit('gasoline')).toBe('km/L');
    expect(economyUnit('ev')).toBe('km/kWh');
  });
});
