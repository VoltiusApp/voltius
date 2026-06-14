import type { SettingsSection } from "@/stores/uiStore";

/** Sections hidden in mobile Settings (host-keyboard-only, etc.). */
export const MOBILE_HIDDEN_SECTIONS = new Set<SettingsSection>(["shortcuts"]);

/** Nav rows visible on mobile: same list minus hidden sections, order preserved. */
export function mobileSettingsNav<T extends { id: SettingsSection }>(nav: T[]): T[] {
  return nav.filter((n) => !MOBILE_HIDDEN_SECTIONS.has(n.id));
}

/** Plugins visible in the list: drop desktopOnly when on mobile. */
export function visiblePlugins<T extends { manifest: { desktopOnly?: boolean } }>(
  plugins: T[],
  isAndroid: boolean,
): T[] {
  return plugins.filter((p) => !(isAndroid && p.manifest.desktopOnly));
}
