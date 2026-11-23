import type { SyncStatus } from '../sync/engine';

export type Tone = 'success' | 'warning' | 'medium' | 'danger' | 'primary';

const ERROR_LABELS: Record<string, string> = {
  unauthorized: '未授權',
};

export function syncChipInfo(status: SyncStatus): { label: string; tone: Tone } {
  if (status.state === 'syncing') return { label: '同步中…', tone: 'primary' };
  if (status.state === 'offline') {
    return {
      label: status.pending > 0 ? `離線 · ${status.pending} 筆待上傳` : '離線',
      tone: 'medium',
    };
  }
  if (status.state === 'error') {
    const reason = status.lastError ? (ERROR_LABELS[status.lastError] ?? status.lastError) : undefined;
    return { label: reason ? `同步錯誤：${reason}` : '同步錯誤', tone: 'danger' };
  }
  if (status.failed > 0) return { label: `⚠ ${status.failed} 筆上傳失敗`, tone: 'danger' };
  if (status.pending > 0) return { label: `↑ ${status.pending} 筆待上傳`, tone: 'warning' };
  return { label: '✓ 已同步', tone: 'success' };
}

export function SyncChip(props: { status: SyncStatus; onTap: () => void }) {
  const info = syncChipInfo(props.status);
  return (
    <button
      type="button"
      className={`sync-chip tone-${info.tone} pressable`}
      onClick={props.onTap}
      aria-label={`${info.label}，點一下立即同步`}
    >
      {info.label}
    </button>
  );
}
