import { describe, expect, it, vi } from 'vitest';
import { updateAppBadge } from './appBadge';

describe('updateAppBadge', () => {
  it('sets the badge count, or clears it at zero', () => {
    const setAppBadge = vi.fn(async () => {});
    const clearAppBadge = vi.fn(async () => {});
    const nav = { setAppBadge, clearAppBadge } as unknown as Navigator;
    updateAppBadge(3, nav);
    expect(setAppBadge).toHaveBeenCalledWith(3);
    updateAppBadge(0, nav);
    expect(clearAppBadge).toHaveBeenCalled();
  });

  it('is a no-op without the Badging API and swallows rejections', () => {
    expect(() => updateAppBadge(2, {} as Navigator)).not.toThrow();
    const nav = { setAppBadge: vi.fn(() => Promise.reject(new Error('denied'))) } as unknown as Navigator;
    expect(() => updateAppBadge(1, nav)).not.toThrow();
  });
});
