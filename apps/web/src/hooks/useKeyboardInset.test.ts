import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { computeKeyboardInset, useKeyboardInset } from './useKeyboardInset';

describe('computeKeyboardInset', () => {
  it('is 0 without visualViewport', () => {
    expect(computeKeyboardInset(800, null)).toBe(0);
  });
  it('is the part of the layout viewport hidden by the keyboard', () => {
    expect(computeKeyboardInset(800, { height: 460, offsetTop: 0 })).toBe(340);
    expect(computeKeyboardInset(800, { height: 460, offsetTop: 40 })).toBe(300);
  });
  it('ignores tiny differences and never goes negative', () => {
    expect(computeKeyboardInset(800, { height: 795, offsetTop: 0 })).toBe(0);
    expect(computeKeyboardInset(800, { height: 900, offsetTop: 0 })).toBe(0);
  });
});

describe('useKeyboardInset', () => {
  const original = window.visualViewport;
  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', { value: original, configurable: true });
  });

  it('tracks visualViewport resize events', () => {
    const target = new EventTarget() as EventTarget & { height: number; offsetTop: number };
    target.height = window.innerHeight;
    target.offsetTop = 0;
    Object.defineProperty(window, 'visualViewport', { value: target, configurable: true });
    const { result } = renderHook(() => useKeyboardInset());
    expect(result.current).toBe(0);
    act(() => {
      target.height = window.innerHeight - 300;
      target.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(300);
  });
});
