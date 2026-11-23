import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';

export interface LongPressOptions {
  /** ms before the long press fires (default 500). */
  delay?: number;
  /** Normal tap. Not called right after a long press. */
  onClick?: (e: React.MouseEvent) => void;
  /** Pointer travel (px) that cancels the press, e.g. scrolling or swiping (default 10). */
  moveTolerance?: number;
}

export interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

/**
 * Long press via pointer events. The iOS callout / desktop right click (contextmenu)
 * also counts as a long press so there is always a way to reach the menu.
 */
export function useLongPress(onLongPress: () => void, options: LongPressOptions = {}): LongPressHandlers {
  const { delay = 500, moveTolerance = 10 } = options;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cb = useRef(onLongPress);
  const clickCb = useRef(options.onClick);
  cb.current = onLongPress;
  clickCb.current = options.onClick;

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const fire = useCallback(() => {
    fired.current = true;
    clear();
    cb.current();
  }, [clear]);

  return {
    onPointerDown: (e) => {
      if (e.button !== undefined && e.button > 0) return;
      fired.current = false;
      clear();
      start.current = { x: e.clientX ?? 0, y: e.clientY ?? 0 };
      timer.current = setTimeout(fire, delay);
    },
    onPointerMove: (e) => {
      if (!start.current) return;
      const dx = (e.clientX ?? 0) - start.current.x;
      const dy = (e.clientY ?? 0) - start.current.y;
      if (Math.hypot(dx, dy) > moveTolerance) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClick: (e) => {
      if (fired.current) {
        fired.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      clickCb.current?.(e);
    },
    onContextMenu: (e) => {
      e.preventDefault();
      if (fired.current) return;
      fire();
    },
  };
}
