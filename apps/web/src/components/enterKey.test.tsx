import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { handleEnterKey } from './enterKey';

function Form(props: { onSave: () => void }) {
  return (
    <form onKeyDown={(e) => handleEnterKey(e, props.onSave)}>
      <input aria-label="a" enterKeyHint="next" />
      <input aria-label="skip" type="checkbox" />
      <input aria-label="b" enterKeyHint="done" />
    </form>
  );
}

describe('handleEnterKey', () => {
  it('moves to the next text field on "next"', () => {
    const onSave = vi.fn();
    render(<Form onSave={onSave} />);
    const a = screen.getByLabelText('a');
    a.focus();
    fireEvent.keyDown(a, { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getByLabelText('b'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves on "done"', () => {
    const onSave = vi.fn();
    render(<Form onSave={onSave} />);
    fireEvent.keyDown(screen.getByLabelText('b'), { key: 'Enter' });
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
