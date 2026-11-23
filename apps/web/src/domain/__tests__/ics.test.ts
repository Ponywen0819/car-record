import { describe, expect, it } from 'vitest';
import { buildIcs } from '../index';

const NOW = new Date(Date.UTC(2026, 10, 23, 3, 4, 5));
const bytes = (s: string) => new TextEncoder().encode(s).length;
const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, '');
const lines = (ics: string) => unfold(ics).split('\r\n');

describe('buildIcs', () => {
  it('builds a calendar with an all-day event', () => {
    const ics = buildIcs([{ uid: 'abc@car-record', title: '換機油', date: '2026-12-31' }], NOW);
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/); // only CRLF line endings
    const ls = lines(ics);
    expect(ls[0]).toBe('BEGIN:VCALENDAR');
    expect(ls).toContain('VERSION:2.0');
    expect(ls.some((l) => l.startsWith('PRODID:'))).toBe(true);
    expect(ls).toContain('BEGIN:VEVENT');
    expect(ls).toContain('UID:abc@car-record');
    expect(ls).toContain('DTSTAMP:20261123T030405Z');
    expect(ls).toContain('DTSTART;VALUE=DATE:20261231');
    expect(ls).toContain('DTEND;VALUE=DATE:20270101');
    expect(ls).toContain('SUMMARY:換機油');
    expect(ls).toContain('END:VEVENT');
    expect(ls.filter(Boolean).at(-1)).toBe('END:VCALENDAR');
    expect(ls.some((l) => l.startsWith('DESCRIPTION'))).toBe(false);
    expect(ls).not.toContain('BEGIN:VALARM');
  });

  it('builds an empty calendar', () => {
    const ls = lines(buildIcs([], NOW));
    expect(ls[0]).toBe('BEGIN:VCALENDAR');
    expect(ls).not.toContain('BEGIN:VEVENT');
    expect(ls).toContain('END:VCALENDAR');
  });

  it('emits one VEVENT per event', () => {
    const ics = buildIcs(
      [
        { uid: 'a', title: 'A', date: '2026-02-28' },
        { uid: 'b', title: 'B', date: '2028-02-28' },
      ],
      NOW,
    );
    const ls = lines(ics);
    expect(ls.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(ls).toContain('DTEND;VALUE=DATE:20260301');
    expect(ls).toContain('DTEND;VALUE=DATE:20280229');
  });

  it('escapes commas, semicolons, backslashes and newlines', () => {
    const ics = buildIcs(
      [{ uid: 'u', title: 'a,b;c\\d', date: '2026-12-01', description: 'line1\nline2\r\nline3' }],
      NOW,
    );
    const ls = lines(ics);
    expect(ls).toContain('SUMMARY:a\\,b\\;c\\\\d');
    expect(ls).toContain('DESCRIPTION:line1\\nline2\\nline3');
  });

  it('adds a VALARM n days before', () => {
    const ls = lines(buildIcs([{ uid: 'u', title: '驗車', date: '2026-12-01', alarmDaysBefore: 7 }], NOW));
    const start = ls.indexOf('BEGIN:VALARM');
    const end = ls.indexOf('END:VALARM');
    expect(start).toBeGreaterThan(ls.indexOf('BEGIN:VEVENT'));
    expect(end).toBeLessThan(ls.indexOf('END:VEVENT'));
    const alarm = ls.slice(start, end + 1);
    expect(alarm).toContain('TRIGGER:-P7D');
    expect(alarm).toContain('ACTION:DISPLAY');
    expect(alarm.some((l) => l.startsWith('DESCRIPTION:'))).toBe(true);
  });

  it('supports an alarm on the day itself', () => {
    expect(lines(buildIcs([{ uid: 'u', title: 'x', date: '2026-12-01', alarmDaysBefore: 0 }], NOW))).toContain(
      'TRIGGER:-P0D',
    );
  });

  it('folds lines longer than 75 octets (ASCII)', () => {
    const title = 'x'.repeat(200);
    const ics = buildIcs([{ uid: 'u', title, date: '2026-12-01' }], NOW);
    for (const l of ics.split('\r\n')) expect(bytes(l)).toBeLessThanOrEqual(75);
    expect(ics).toContain('\r\n ');
    expect(lines(ics)).toContain(`SUMMARY:${title}`);
  });

  it('folds UTF-8 text without splitting multi-byte characters', () => {
    const title = '定期保養：機油、機油芯、空氣濾網、冷氣濾網、煞車油、變速箱油、水箱水、火星塞🚗🚙'.repeat(3);
    const ics = buildIcs([{ uid: 'u', title, date: '2026-12-01', description: '保險到期，請記得續保。'.repeat(10) }], NOW);
    const physical = ics.split('\r\n');
    for (const l of physical) {
      expect(bytes(l)).toBeLessThanOrEqual(75);
      // no lone surrogates
      expect(l).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    // folding packs lines reasonably full (more than 70 octets for all but the last piece)
    const summaryStart = physical.findIndex((l) => l.startsWith('SUMMARY:'));
    expect(bytes(physical[summaryStart]!)).toBeGreaterThan(70);
    expect(lines(ics)).toContain(`SUMMARY:${title}`); // full-width punctuation is not escaped
  });

  it('does not fold a line of exactly 75 octets', () => {
    const title = 'y'.repeat(75 - 'SUMMARY:'.length);
    const ics = buildIcs([{ uid: 'u', title, date: '2026-12-01' }], NOW);
    expect(ics.split('\r\n')).toContain(`SUMMARY:${title}`);
  });

  it('defaults DTSTAMP to now', () => {
    expect(lines(buildIcs([{ uid: 'u', title: 't', date: '2026-12-01' }])).some((l) => /^DTSTAMP:\d{8}T\d{6}Z$/.test(l))).toBe(
      true,
    );
  });
});
