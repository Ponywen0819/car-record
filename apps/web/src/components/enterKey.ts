import type React from 'react';

const FOCUSABLE =
  'input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=date]):not([disabled]), textarea, select';

/**
 * Form-level Enter handling (SPEC §5.3): on a field with enterkeyhint="next" focus the next
 * field; otherwise ("done") save.
 */
export function handleEnterKey(e: React.KeyboardEvent<HTMLElement>, onSave: () => void) {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
  const target = e.target as HTMLElement;
  if (!(target instanceof HTMLInputElement)) return;
  e.preventDefault();
  if (target.getAttribute('enterkeyhint') === 'next') {
    const fields = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
    const next = fields[fields.indexOf(target) + 1];
    if (next) {
      next.focus();
      return;
    }
  }
  target.blur();
  onSave();
}
