export type AddKind = 'fuel' | 'maintenance' | 'expense';

const ADD_KINDS: readonly AddKind[] = ['fuel', 'maintenance', 'expense'];

/** '/add/fuel' → 'fuel' (iOS Shortcuts / NFC deep links, SPEC §5.4). */
export function parseAddPath(pathname: string): AddKind | null {
  const m = /^\/add\/([a-z]+)\/?$/i.exec(pathname);
  if (!m?.[1]) return null;
  const kind = m[1].toLowerCase() as AddKind;
  return ADD_KINDS.includes(kind) ? kind : null;
}
