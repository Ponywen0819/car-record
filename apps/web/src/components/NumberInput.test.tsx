import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NumberInput } from './NumberInput';

describe('<NumberInput>', () => {
  it('is a text input with the decimal keyboard (not type=number)', () => {
    render(<NumberInput label="里程" value="52340" onChange={() => {}} enterKeyHint="next" />);
    const input = screen.getByLabelText('里程') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(input).toHaveAttribute('enterkeyhint', 'next');
  });

  it('selects the whole value on focus when selectOnFocus is set', () => {
    render(<NumberInput label="里程" value="52340" onChange={() => {}} selectOnFocus />);
    const input = screen.getByLabelText('里程') as HTMLInputElement;
    fireEvent.focus(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
  });

  it('reports changes, shows suffix, hint and error', () => {
    const onChange = vi.fn();
    const { rerender } = render(<NumberInput label="油量" value="" onChange={onChange} suffix="L" hint="自動計算" />);
    fireEvent.change(screen.getByLabelText('油量'), { target: { value: '40.5' } });
    expect(onChange).toHaveBeenCalledWith('40.5');
    expect(screen.getByText('L')).toBeInTheDocument();
    expect(screen.getByText('自動計算')).toBeInTheDocument();
    // the error replaces the hint
    rerender(<NumberInput label="油量" value="" onChange={onChange} suffix="L" hint="自動計算" error="請輸入油量" />);
    expect(screen.getByRole('alert')).toHaveTextContent('請輸入油量');
    expect(screen.queryByText('自動計算')).toBeNull();
  });
});
