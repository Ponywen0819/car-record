type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Home-screen icon badge (iOS 16.4+, Badging API). Silently does nothing elsewhere. */
export function updateAppBadge(count: number, nav: BadgeNavigator = navigator): void {
  try {
    const p = count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.();
    p?.catch(() => {});
  } catch {
    // unsupported / not permitted
  }
}
