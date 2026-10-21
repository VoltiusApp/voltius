/**
 * Pure Android back planner — no React/zustand so it's node-testable.
 *
 * One hardware-back press closes exactly one thing, topmost first:
 *   transient overlays (sheets, popovers, folder levels — LIFO, on the current layer)
 *   → settings drill-down → settings → nav sheet → stack page → non-hosts tab
 *   → nothing (null: the native shell hands the press to the system).
 *
 * Interceptors carry the layer `depth` they were registered on (see `backDepth`).
 * One registered on a lower layer than the current one (e.g. a Hosts folder level
 * while Settings is open over it) waits until that layer is on top again.
 */
import { handleBack, type MobileNavState } from "@/stores/mobileNavCore";

export interface BackInterceptorEntry {
  id: number;
  /** Layer the interceptor was registered on (`backDepth` at registration time). */
  depth: number;
}

export interface BackSettingsState {
  settingsOpen: boolean;
  settingsSubPage: unknown;
}

export interface BackState {
  interceptors: readonly BackInterceptorEntry[];
  settings: BackSettingsState;
  nav: MobileNavState;
}

export type BackAction =
  | { kind: "interceptor"; id: number }
  | { kind: "settings-subpage" }
  | { kind: "settings" }
  | { kind: "nav" };

/** Current layer depth: tab (non-hosts) < pushed pages < settings < settings drill-down. */
export function backDepth(nav: MobileNavState, settings: BackSettingsState): number {
  const tab = nav.tab !== "hosts" ? 1 : 0;
  const s = settings.settingsOpen ? 1 + (settings.settingsSubPage ? 1 : 0) : 0;
  return tab + nav.stack.length + s;
}

/** What the next back press closes, or null when nothing is left (root). */
export function planBack(s: BackState): BackAction | null {
  const depth = backDepth(s.nav, s.settings);
  for (let i = s.interceptors.length - 1; i >= 0; i--) {
    if (s.interceptors[i].depth >= depth) return { kind: "interceptor", id: s.interceptors[i].id };
  }
  if (s.settings.settingsOpen) return { kind: s.settings.settingsSubPage ? "settings-subpage" : "settings" };
  if (handleBack(s.nav).handled) return { kind: "nav" };
  // Unreachable in practice (depth 0 accepts every interceptor), kept for safety.
  const last = s.interceptors[s.interceptors.length - 1];
  return last ? { kind: "interceptor", id: last.id } : null;
}
