import type { FuelType } from '@car-record/shared';
import {
  averageEconomy,
  collectReadings,
  computeAllDeadlines,
  computeAllReminders,
  computeFuelEconomy,
  detectEconomyAnomaly,
  estimateOdometer,
  type DeadlineStatus,
  type FuelEconomyPoint,
  type OdometerEstimate,
  type OdometerReading,
  type ReminderStatus,
} from '../../domain';
import type { VehicleData } from '../../hooks/useVehicleData';
import { formatNumber } from '../../lib/format';

export interface VehicleState {
  readings: OdometerReading[];
  estimate: OdometerEstimate | null;
  economy: FuelEconomyPoint[];
  latestEconomy: FuelEconomyPoint | null;
  averageEconomy: number | null;
  anomaly: ReturnType<typeof detectEconomyAnomaly>;
  reminders: ReminderStatus[];
  deadlines: DeadlineStatus[];
}

/** Everything the screens derive from one vehicle's records. */
export function deriveVehicleState(data: VehicleData, today: string): VehicleState {
  const { vehicle, fuel, maintenance, expenses } = data;
  const readings = collectReadings({ vehicle, fuel, maintenance, expenses });
  const estimate = estimateOdometer(readings, today);
  const economy = computeFuelEconomy(fuel);
  const reminders = computeAllReminders(data.reminderRules, {
    maintenance,
    currentOdometer: estimate?.value ?? null,
    dailyKm: estimate?.dailyKm ?? null,
    today,
    vehicle,
  });
  return {
    readings,
    estimate,
    economy,
    latestEconomy: economy.at(-1) ?? null,
    averageEconomy: averageEconomy(economy),
    anomaly: detectEconomyAnomaly(economy),
    reminders,
    deadlines: computeAllDeadlines(data.deadlines, today),
  };
}

const urgent = (level: string) => level === 'overdue' || level === 'soon';

/** App icon badge: overdue + soon reminders and deadlines. */
export function badgeCount(state: Pick<VehicleState, 'reminders' | 'deadlines'>): number {
  return state.reminders.filter((r) => urgent(r.level)).length + state.deadlines.filter((d) => urgent(d.level)).length;
}

/** 「剩 320 km／45 天」 */
export function reminderSummary(s: ReminderStatus): string {
  if (s.level === 'unknown') return '尚無紀錄，請登錄上次保養';
  const parts: string[] = [];
  if (s.remainingKm !== undefined) {
    parts.push(s.remainingKm < 0 ? `超過 ${formatNumber(-s.remainingKm)} km` : `剩 ${formatNumber(s.remainingKm)} km`);
  }
  if (s.remainingDays !== undefined) {
    const d = s.remainingDays;
    if (parts.length > 0) parts.push(d < 0 ? `逾期 ${-d} 天` : `${d} 天`);
    else parts.push(d < 0 ? `逾期 ${-d} 天` : `剩 ${d} 天`);
  }
  const text = parts.join('／');
  return s.snoozed ? `已延後 · ${text}` : text;
}

export function deadlineSummary(s: DeadlineStatus): string {
  if (s.remainingDays < 0) return `已逾期 ${-s.remainingDays} 天`;
  if (s.remainingDays === 0) return '今天到期';
  return `剩 ${s.remainingDays} 天（${s.deadline.dueDate}）`;
}

export function economyUnit(fuelType: FuelType): 'km/L' | 'km/kWh' {
  return fuelType === 'ev' ? 'km/kWh' : 'km/L';
}

export const LEVEL_COLORS: Record<string, string> = {
  overdue: 'danger',
  soon: 'warning',
  unknown: 'medium',
  ok: 'success',
};
