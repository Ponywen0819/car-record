import { TABLES, recordSchemas, type TableName, type TableRecordMap } from '@car-record/shared';
import { alive } from './util';

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const BOM = '﻿';
const CRLF = '\r\n';

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  let s: string;
  if (typeof value === 'string') s = value;
  else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') s = String(value);
  else if (value instanceof Date) s = value.toISOString();
  else s = JSON.stringify(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV with UTF-8 BOM (so Excel opens Chinese correctly); CRLF line endings (incl. after the last row). */
export function toCsv(rows: Record<string, unknown>[], columns: { key: string; header: string }[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c.key])).join(','));
  return BOM + lines.join(CRLF) + CRLF;
}

// ---------------------------------------------------------------------------
// JSON snapshot
// ---------------------------------------------------------------------------

export interface ExportSnapshot {
  version: 1;
  exportedAt: string;
  tables: { [T in TableName]: TableRecordMap[T][] };
}

type Tables = ExportSnapshot['tables'];

/** Snapshot of every table (soft-deleted records are dropped; missing tables become []). */
export function buildSnapshot(tables: Tables, now: Date = new Date()): ExportSnapshot {
  const out = {} as Record<TableName, unknown[]>;
  for (const t of TABLES) out[t] = alive((tables[t] ?? []) as { deletedAt?: number }[]);
  return { version: 1, exportedAt: now.toISOString(), tables: out as Tables };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parse + validate (every record against its schema). Throws Error with a readable message.
 * Missing tables default to []; unknown tables and unknown fields are dropped; soft-deleted
 * records are dropped.
 */
export function parseSnapshot(json: string): ExportSnapshot {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isObject(data)) throw new Error('Invalid snapshot: expected a JSON object');
  if (data.version !== 1) throw new Error(`Unsupported snapshot version: ${JSON.stringify(data.version ?? null)}`);
  if (typeof data.exportedAt !== 'string') throw new Error('Invalid snapshot: missing exportedAt');
  if (!isObject(data.tables)) throw new Error('Invalid snapshot: missing tables');

  const tables = {} as Record<TableName, unknown[]>;
  for (const t of TABLES) {
    const raw = data.tables[t];
    if (raw === undefined || raw === null) {
      tables[t] = [];
      continue;
    }
    if (!Array.isArray(raw)) throw new Error(`Invalid snapshot: table "${t}" must be an array`);
    const records: { deletedAt?: number }[] = [];
    raw.forEach((rec, index) => {
      const result = recordSchemas[t].safeParse(rec);
      if (!result.success) {
        const issue = result.error.issues[0];
        const id = isObject(rec) && typeof rec.id === 'string' ? ` (id ${rec.id})` : '';
        const where = issue && issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ` : '';
        throw new Error(`Invalid record in table "${t}" at index ${index}${id}: ${where}${issue?.message ?? 'invalid'}`);
      }
      records.push(result.data as { deletedAt?: number });
    });
    tables[t] = alive(records);
  }
  return { version: 1, exportedAt: data.exportedAt, tables: tables as Tables };
}
