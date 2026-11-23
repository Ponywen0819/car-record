import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChipSelect } from './ChipSelect';

const options = [
  { value: 'engine_oil', label: '機油' },
  { value: 'oil_filter', label: '機油芯' },
];

describe('<ChipSelect>', () => {
  it('marks selected chips with aria-pressed and highlights hinted ones', () => {
    render(<ChipSelect options={options} selected={['oil_filter']} hinted={['engine_oil']} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: /機油芯/ })).toHaveAttribute('aria-pressed', 'true');
    const oil = screen.getAllByRole('button')[0]!;
    expect(oil).toHaveAttribute('aria-pressed', 'false');
    expect(oil.className).toContain('hinted');
  });

  it('reports toggles', async () => {
    const onToggle = vi.fn();
    render(<ChipSelect options={options} selected={[]} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: '機油芯' }));
    expect(onToggle).toHaveBeenCalledWith('oil_filter');
  });
});
