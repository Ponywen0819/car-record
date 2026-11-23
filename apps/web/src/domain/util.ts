/** Records that are not soft-deleted. */
export function alive<T extends { deletedAt?: number }>(records: readonly T[]): T[] {
  return records.filter((r) => r.deletedAt === undefined || r.deletedAt === null);
}

/** Round half up to `decimals`, avoiding binary float artefacts (1.005 → 1.01). */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(Number.parseFloat((value * factor).toPrecision(12))) / factor;
}
