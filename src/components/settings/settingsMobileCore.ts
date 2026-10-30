import type { SettingsSection } from "@/stores/uiStore";

/**
 * Sections hidden in mobile Settings: shortcuts are host-keyboard-only, and integrations
 * is all MCP, a local server no client on the phone can reach (the backend refuses it).
 */
export const MOBILE_HIDDEN_SECTIONS = new Set<SettingsSection>(["shortcuts", "integrations", "devices"]);

/**
 * Toggles hidden in mobile Settings because nothing reads them on Android: tab grouping
 * lives in the desktop title bar, drag-selects-text only changes mouse drags.
 */
export const MOBILE_HIDDEN_TOGGLES = new Set<string>(["group-tabs-by-host", "drag-selects-text"]);

/** Nav rows visible on mobile: same list minus hidden sections, order preserved. */
export function mobileSettingsNav<T extends { id: SettingsSection }>(nav: T[]): T[] {
  return nav.filter((n) => !MOBILE_HIDDEN_SECTIONS.has(n.id));
}

/** Plugins visible in the list: drop desktopOnly when on mobile. */
export function visiblePlugins<T extends { manifest: { desktopOnly?: boolean } }>(
  plugins: T[],
  isMobile: boolean,
): T[] {
  return plugins.filter((p) => !(isMobile && p.manifest.desktopOnly));
}

/** Android list row whose tap anywhere runs its trailing control (switch, picker, …). */
export const ROW_ATTR = "data-setting-row";
/** The control a row tap forwards to. */
export const ROW_CONTROL_ATTR = "data-row-control";

const INTERACTIVE = "button, a, input, select, textarea, label, [role=switch], [role=button], [contenteditable=true]";

/**
 * M3 list rows act as one target: a tap on the row's text forwards to its control.
 * Returns the control to click, or null when the tap already hit something interactive
 * inside the row (the control itself, a Reset button, a link) or there is no enabled control.
 */
export function rowTapControl(target: Element | null): HTMLElement | null {
  const row = target?.closest<HTMLElement>(`[${ROW_ATTR}]`);
  if (!row || !target) return null;
  const hit = target.closest(INTERACTIVE);
  if (hit && hit !== row && row.contains(hit)) return null;
  const control = row.querySelector<HTMLElement>(`[${ROW_CONTROL_ATTR}]`);
  if (!control || (control as HTMLButtonElement).disabled || control.getAttribute("aria-disabled") === "true") return null;
  return control;
}

/** i18n key list for a string that has a touch wording: `<key>Mobile` first on Android. */
export function mobileKey(key: string, isMobile: boolean): string | string[] {
  return isMobile ? [`${key}Mobile`, key] : key;
}
