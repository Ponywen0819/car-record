import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useLongPress } from './useLongPress';

function Button(props: { onLongPress: () => void; onClick: () => void }) {
  const handlers = useLongPress(props.onLongPress, { onClick: props.onClick, delay: 500 });
  return (
    <button type="button" {...handlers}>
      press
    </button>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useLongPress', () => {
  it('fires onLongPress after the delay and swallows the following click', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(<Button onLongPress={onLongPress} onClick={onClick} />);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(499);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(btn);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('treats a short press as a click', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(<Button onLongPress={onLongPress} onClick={onClick} />);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(100);
    fireEvent.pointerUp(btn);
    fireEvent.click(btn);
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('cancels when the finger moves (scrolling / swiping)', () => {
    const onLongPress = vi.fn();
    render(<Button onLongPress={onLongPress} onClick={() => {}} />);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(btn, { clientX: 40, clientY: 12 });
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('treats the context menu (iOS callout / right click) as a long press', () => {
    const onLongPress = vi.fn();
    render(<Button onLongPress={onLongPress} onClick={() => {}} />);
    fireEvent.contextMenu(screen.getByRole('button'));
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });
});
