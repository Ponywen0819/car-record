import { describe, expect, it } from 'vitest';
import { TABLES } from '@car-record/shared';
import { buildSnapshot, parseSnapshot, toCsv, type ExportSnapshot } from '../index';
import { deadline, expense, fuel, maint, rule, vehicle } from './fixtures';

const BOM = '﻿';

describe('toCsv', () => {
  const cols = [
    { key: 'date', header: '日期' },
    { key: 'cost', header: '金額' },
    { key: 'note', header: '備註' },
  ];

  it('starts with a BOM and uses CRLF line endings', () => {
    const csv = toCsv([{ date: '2026-01-01', cost: 100, note: '加油' }], cols);
    expect(csv).toBe(`${BOM}日期,金額,備註\r\n2026-01-01,100,加油\r\n`);
  });

  it('outputs only the header for no rows', () => {
    expect(toCsv([], cols)).toBe(`${BOM}日期,金額,備註\r\n`);
  });

  it('leaves missing values empty', () => {
    expect(toCsv([{ date: '2026-01-01', note: null }], cols)).toBe(`${BOM}日期,金額,備註\r\n2026-01-01,,\r\n`);
  });

  it('quotes commas, quotes and newlines', () => {
    const csv = toCsv([{ date: '2026-01-01', cost: 0, note: 'a,b "c"\nd' }], cols);
    expect(csv).toBe(`${BOM}日期,金額,備註\r\n2026-01-01,0,"a,b ""c""\nd"\r\n`);
    expect(toCsv([{ note: 'x\r\ny' }], [{ key: 'note', header: 'n' }])).toBe(`${BOM}n\r\n"x\r\ny"\r\n`);
  });

  it('quotes headers when needed and formats booleans and arrays', () => {
    const csv = toCsv([{ a: true, b: ['x', 'y'] }], [
      { key: 'a', header: 'full, tank' },
      { key: 'b', header: 'items' },
    ]);
    expect(csv).toBe(`${BOM}"full, tank",items\r\ntrue,"[""x"",""y""]"\r\n`);
  });
});

const tables = (): ExportSnapshot['tables'] => ({
  vehicles: [vehicle({ purchaseDate: '2025-01-01' })],
  maintenance: [maint({ date: '2026-01-01', odometer: 100, shop: '原廠' })],
  fuel: [fuel({ date: '2026-01-02', odometer: 200, cost: 1200, unitPrice: 30 })],
  expenses: [expense({ date: '2026-01-03', cost: 50 })],
  reminderRules: [rule()],
  deadlines: [deadline({ dueDate: '2026-12-01', repeatEveryMonths: 12 })],
});

describe('buildSnapshot / parseSnapshot', () => {
  it('builds a version 1 snapshot with an ISO timestamp', () => {
    const now = new Date(Date.UTC(2026, 10, 23, 1, 2, 3));
    const t = tables();
    const snap = buildSnapshot(t, now);
    expect(snap.version).toBe(1);
    expect(snap.exportedAt).toBe('2026-11-23T01:02:03.000Z');
    expect(snap.tables).toEqual(t);
  });

  it('drops soft-deleted records from the snapshot', () => {
    const t = tables();
    t.fuel.push(fuel({ date: '2026-01-05', odometer: 300, deletedAt: 9 }));
    const snap = buildSnapshot(t);
    expect(snap.tables.fuel).toHaveLength(1);
    expect(snap.tables.fuel[0]!.deletedAt).toBeUndefined();
  });

  it('round-trips through JSON', () => {
    const snap = buildSnapshot(tables(), new Date(0));
    expect(parseSnapshot(JSON.stringify(snap))).toEqual(snap);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseSnapshot('{not json')).toThrow(/JSON/);
    expect(() => parseSnapshot('')).toThrow(/JSON/);
  });

  it('rejects non-object payloads', () => {
    expect(() => parseSnapshot('[]')).toThrow(Error);
    expect(() => parseSnapshot('null')).toThrow(Error);
    expect(() => parseSnapshot('42')).toThrow(Error);
  });

  it('rejects a wrong version', () => {
    const snap = { ...buildSnapshot(tables()), version: 2 };
    expect(() => parseSnapshot(JSON.stringify(snap))).toThrow(/version/i);
    const { version: _v, ...noVersion } = buildSnapshot(tables());
    expect(() => parseSnapshot(JSON.stringify(noVersion))).toThrow(/version/i);
  });

  it('rejects an invalid record and names the table', () => {
    const snap = buildSnapshot(tables());
    const bad = JSON.parse(JSON.stringify(snap));
    bad.tables.fuel[0].amount = -5;
    expect(() => parseSnapshot(JSON.stringify(bad))).toThrow(/fuel/);
    const bad2 = JSON.parse(JSON.stringify(snap));
    bad2.tables.reminderRules[0] = { ...bad2.tables.reminderRules[0], everyKm: undefined, everyMonths: undefined };
    expect(() => parseSnapshot(JSON.stringify(bad2))).toThrow(/reminderRules/);
  });

  it('rejects a table that is not an array', () => {
    const bad = JSON.parse(JSON.stringify(buildSnapshot(tables())));
    bad.tables.deadlines = { a: 1 };
    expect(() => parseSnapshot(JSON.stringify(bad))).toThrow(/deadlines/);
  });

  it('rejects missing tables object', () => {
    expect(() => parseSnapshot(JSON.stringify({ version: 1, exportedAt: 'x' }))).toThrow(/tables/);
  });

  it('defaults missing tables to []', () => {
    const t = tables();
    const parsed = parseSnapshot(
      JSON.stringify({ version: 1, exportedAt: '2026-01-01T00:00:00.000Z', tables: { vehicles: t.vehicles } }),
    );
    expect(parsed.tables.vehicles).toEqual(t.vehicles);
    for (const name of TABLES) expect(Array.isArray(parsed.tables[name])).toBe(true);
    expect(parsed.tables.fuel).toEqual([]);
  });

  it('drops soft-deleted records when parsing', () => {
    const snap = JSON.parse(JSON.stringify(buildSnapshot(tables())));
    snap.tables.expenses.push({ ...snap.tables.expenses[0], id: 'gone', deletedAt: 5 });
    expect(parseSnapshot(JSON.stringify(snap)).tables.expenses.map((e) => e.id)).not.toContain('gone');
  });

  it('strips unknown fields and ignores unknown tables', () => {
    const snap = JSON.parse(JSON.stringify(buildSnapshot(tables())));
    snap.tables.fuel[0].bogus = 1;
    snap.tables.photos = [{ id: 'p' }];
    const parsed = parseSnapshot(JSON.stringify(snap));
    expect('bogus' in parsed.tables.fuel[0]!).toBe(false);
    expect('photos' in parsed.tables).toBe(false);
  });
});
