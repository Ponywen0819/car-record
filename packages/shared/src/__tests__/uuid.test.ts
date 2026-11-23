import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../uuid';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('produces RFC 9562 version 7 UUIDs', () => {
    for (let i = 0; i < 50; i++) expect(uuidv7()).toMatch(UUID_RE);
  });

  it('encodes the timestamp in the first 48 bits', () => {
    const ms = Date.UTC(2030, 10, 23, 12, 0, 0);
    const id = uuidv7(ms);
    const hex = id.replace(/-/g, '').slice(0, 12);
    expect(parseInt(hex, 16)).toBe(ms);
  });

  it('is unique and sortable in generation order, even within the same millisecond', () => {
    const now = Date.UTC(2031, 0, 1);
    const ids = Array.from({ length: 5000 }, () => uuidv7(now));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('stays monotonic when the clock goes backwards', () => {
    const a = uuidv7(Date.UTC(2032, 0, 2));
    const b = uuidv7(Date.UTC(2032, 0, 1));
    expect(b > a).toBe(true);
  });
});
