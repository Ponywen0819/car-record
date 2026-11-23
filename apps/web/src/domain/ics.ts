import { addDays } from './dates';

export interface CalendarEvent {
  uid: string;
  title: string;
  /** All-day event date YYYY-MM-DD. */
  date: string;
  description?: string;
  /** Adds a VALARM this many days before (at 09:00 local is fine to approximate with -P{n}D). */
  alarmDaysBefore?: number;
}

const CRLF = '\r\n';
const MAX_OCTETS = 75;

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, newlines. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Fold a content line so that no physical line exceeds 75 octets (UTF-8), never splitting a
 * character. Continuation lines start with a single space, which counts toward the limit.
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const ch of line) {
    const len = utf8Length(ch.codePointAt(0)!);
    if (octets + len > MAX_OCTETS) {
      parts.push(current);
      current = ' ';
      octets = 1;
    }
    current += ch;
    octets += len;
  }
  parts.push(current);
  return parts.join(CRLF);
}

const icsDate = (date: string) => date.replace(/-/g, '');

function icsTimestamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 5545 VCALENDAR with all-day VEVENTs; CRLF line endings; escapes , ; \ and newlines; folds lines > 75 octets. */
export function buildIcs(events: CalendarEvent[], now: Date = new Date()): string {
  const stamp = icsTimestamp(now);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//car-record//car-record//ZH-TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(e.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(e.date, 1))}`,
      `SUMMARY:${escapeIcsText(e.title)}`,
    );
    if (e.description !== undefined && e.description !== '') {
      lines.push(`DESCRIPTION:${escapeIcsText(e.description)}`);
    }
    if (e.alarmDaysBefore !== undefined && e.alarmDaysBefore >= 0) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcsText(e.title)}`,
        `TRIGGER:-P${Math.floor(e.alarmDaysBefore)}D`,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
