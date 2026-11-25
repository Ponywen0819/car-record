/**
 * Domain logic contract — pure, synchronous, framework-free functions.
 * All dates are local ISO dates 'YYYY-MM-DD'; months are 'YYYY-MM'.
 * Every function must ignore soft-deleted records (deletedAt set) in its inputs.
 *
 * Owned by the domain workstream. The UI imports ONLY from this file.
 * Signatures here are the contract: implement them (in separate modules, re-exported
 * here), don't change them without updating every caller.
 *
 * Contract (see each module for the full doc comments):
 *
 * dates.ts
 *   todayISO(now?: Date): string
 *   daysBetween(a: string, b: string): number
 *   addDays(date: string, days: number): string
 *   addMonths(date: string, months: number): string
 *   isoDateFromMs(ms: number): string
 *   lastNMonths(today: string, n: number): string[]
 * odometer.ts
 *   OdometerReading, collectReadings, estimateDailyKm, OdometerEstimate, estimateOdometer,
 *   OdometerCheck, checkOdometer
 * fuel.ts
 *   FuelEconomyPoint, computeFuelEconomy, averageEconomy, detectEconomyAnomaly, PriceInput, solvePrice
 * reminders.ts
 *   ReminderLevel, ReminderContext, ReminderStatus, computeReminderStatus, computeAllReminders,
 *   snoozeReminder, dueItemKeys, DeadlineStatus, computeDeadlineStatus, computeAllDeadlines,
 *   completeDeadline
 * stats.ts
 *   CostEntry, collectCosts, MonthlyCost, monthlyCosts, costByCategory, costPerKm, monthlyDistance
 * defaults.ts
 *   defaultReminderRules, lastValue
 * ics.ts
 *   CalendarEvent, buildIcs
 * exportData.ts
 *   toCsv, ExportSnapshot, buildSnapshot, parseSnapshot
 * einvoice.ts
 *   EInvoiceError, EInvoiceItem, EInvoice, FuelInvoiceFill, parseEInvoice, fuelFromInvoice
 */

export { todayISO, daysBetween, addDays, addMonths, isoDateFromMs, lastNMonths, monthOf } from './dates';

export {
  collectReadings,
  estimateDailyKm,
  estimateOdometer,
  checkOdometer,
  type OdometerReading,
  type OdometerEstimate,
  type OdometerCheck,
} from './odometer';

export {
  computeFuelEconomy,
  averageEconomy,
  detectEconomyAnomaly,
  solvePrice,
  fuelCost,
  type FuelEconomyPoint,
  type PriceInput,
} from './fuel';

export {
  computeReminderStatus,
  computeAllReminders,
  snoozeReminder,
  dueItemKeys,
  computeDeadlineStatus,
  computeAllDeadlines,
  completeDeadline,
  type ReminderLevel,
  type ReminderContext,
  type ReminderStatus,
  type DeadlineStatus,
} from './reminders';

export {
  collectCosts,
  monthlyCosts,
  costByCategory,
  costPerKm,
  monthlyDistance,
  maintenanceCost,
  type CostEntry,
  type MonthlyCost,
} from './stats';

export { defaultReminderRules, lastValue } from './defaults';

export { buildIcs, type CalendarEvent } from './ics';

export { toCsv, buildSnapshot, parseSnapshot, type ExportSnapshot } from './exportData';

export {
  EInvoiceError,
  parseEInvoice,
  fuelFromInvoice,
  type EInvoiceItem,
  type EInvoice,
  type FuelInvoiceFill,
} from './einvoice';
