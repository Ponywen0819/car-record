import { useEffect, useState } from 'react';

const MIN_INSET = 60;

/**
 * Height of the on-screen keyboard: the part of the layout viewport the visual viewport
 * no longer covers. iOS standalone PWAs don't resize the layout viewport for the keyboard,
 * so fixed footers would otherwise sit behind it (SPEC §5.3).
 */
export function computeKeyboardInset(
  layoutHeight: number,
  vv: { height: number; offsetTop: number } | null | undefined,
): number {
  if (!vv) return 0;
  const inset = Math.round(layoutHeight - vv.height - vv.offsetTop);
  return inset >= MIN_INSET ? inset : 0;
}

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(() => computeKeyboardInset(window.innerHeight, window.visualViewport));
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(computeKeyboardInset(window.innerHeight, vv));
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}
