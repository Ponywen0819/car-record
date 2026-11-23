import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SyncChip, syncChipInfo } from './SyncChip';
import type { SyncStatus } from '../sync/engine';

const s = (p: Partial<SyncStatus>): SyncStatus => ({ state: 'idle', pending: 0, failed: 0, ...p });

describe('syncChipInfo', () => {
  it('shows synced when idle with nothing pending', () => {
    expect(syncChipInfo(s({}))).toEqual({ label: '✓ 已同步', tone: 'success' });
  });
  it('shows the pending count', () => {
    expect(syncChipInfo(s({ pending: 3 })).label).toBe('↑ 3 筆待上傳');
  });
  it('shows offline (with pending count when any)', () => {
    expect(syncChipInfo(s({ state: 'offline' })).label).toBe('離線');
    expect(syncChipInfo(s({ state: 'offline', pending: 2 })).label).toBe('離線 · 2 筆待上傳');
  });
  it('shows errors and failed entries', () => {
    expect(syncChipInfo(s({ state: 'error' }))).toEqual({ label: '同步錯誤', tone: 'danger' });
    expect(syncChipInfo(s({ state: 'error', lastError: 'unauthorized' })).label).toBe('同步錯誤：未授權');
    expect(syncChipInfo(s({ failed: 1 })).label).toBe('⚠ 1 筆上傳失敗');
  });
  it('shows syncing', () => {
    expect(syncChipInfo(s({ state: 'syncing' })).label).toBe('同步中…');
  });
});

describe('<SyncChip>', () => {
  it('renders the label and triggers sync on tap', async () => {
    const onTap = vi.fn();
    render(<SyncChip status={s({ pending: 1 })} onTap={onTap} />);
    const btn = screen.getByRole('button', { name: /1 筆待上傳/ });
    await userEvent.click(btn);
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});
