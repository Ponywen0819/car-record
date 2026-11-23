import { describe, expect, it } from 'vitest';
import { compact, formatInputNumber, formatKm, formatMoney, formatNumber, isBlank, monthLabel, parseDecimal, parseInteger } from './format';

describe('parseDecimal', () => {
  it('returns undefined for blank input', () => {
    expect(parseDecimal('')).toBeUndefined();
    expect(parseDecimal('   ')).toBeUndefined();
  });
  it('parses plain and grouped numbers', () => {
    expect(parseDecimal('42')).toBe(42);
    expect(parseDecimal('1,234.5')).toBe(1234.5);
    expect(parseDecimal(' 52 340 ')).toBe(52340);
    expect(parseDecimal('12.')).toBe(12);
    expect(parseDecimal('.5')).toBe(0.5);
  });
  it('accepts full-width digits and decimal point (zh-TW IME)', () => {
    expect(parseDecimal('１２３．５')).toBe(123.5);
  });
  it('returns NaN for garbage so callers can show a format error', () => {
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('1.2.3')).toBeNaN();
    expect(parseDecimal('-5')).toBeNaN();
  });
});

describe('parseInteger', () => {
  it('parses integers and rejects decimals', () => {
    expect(parseInteger('12')).toBe(12);
    expect(parseInteger('')).toBeUndefined();
    expect(parseInteger('1.5')).toBeNaN();
  });
});

describe('isBlank', () => {
  it('detects whitespace-only strings', () => {
    expect(isBlank('  ')).toBe(true);
    expect(isBlank('0')).toBe(false);
  });
});

describe('formatting', () => {
  it('formats numbers with thousand separators', () => {
    expect(formatNumber(52340)).toBe('52,340');
    expect(formatNumber(14.236, 1)).toBe('14.2');
  });
  it('formats km and money', () => {
    expect(formatKm(52340)).toBe('52,340 km');
    expect(formatMoney(1234.4)).toBe('$1,234');
  });
  it('formats numbers for inputs without grouping', () => {
    expect(formatInputNumber(52340)).toBe('52340');
    expect(formatInputNumber(undefined)).toBe('');
    expect(formatInputNumber(1.5)).toBe('1.5');
  });
  it('labels months', () => {
    expect(monthLabel('2026-11')).toBe('2026 年 11 月');
    expect(monthLabel('2026-03', true)).toBe('3月');
  });
});

describe('compact', () => {
  it('drops undefined and empty-string values', () => {
    expect(compact({ a: 1, b: undefined, c: '', d: 0, e: false })).toEqual({ a: 1, d: 0, e: false });
  });
});
