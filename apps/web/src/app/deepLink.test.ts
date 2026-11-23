import { describe, expect, it } from 'vitest';
import { parseAddPath } from './deepLink';

describe('parseAddPath', () => {
  it('recognises the iOS Shortcuts / NFC add routes', () => {
    expect(parseAddPath('/add/fuel')).toBe('fuel');
    expect(parseAddPath('/add/maintenance/')).toBe('maintenance');
    expect(parseAddPath('/add/Expense')).toBe('expense');
  });
  it('ignores everything else', () => {
    expect(parseAddPath('/add')).toBeNull();
    expect(parseAddPath('/add/car')).toBeNull();
    expect(parseAddPath('/home')).toBeNull();
    expect(parseAddPath('/reminders')).toBeNull();
  });
});
