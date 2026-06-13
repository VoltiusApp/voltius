/** Pure mobile navigation state machine — no React/zustand so it's node-testable. */

export type MobileTab = "hosts" | "terminal" | "snippets" | "more";

export type MorePage = "keychain" | "port-forwarding" | "known-hosts" | "members" | "logs";

export type MobileScreen =
  | { kind: "host-edit"; hostId?: string }
  | { kind: "snippet-edit"; snippetId?: string }
  | { kind: "more-page"; page: MorePage }
  | { kind: "sftp" };

export type MobileSheet =
  | { kind: "vault-switcher" }
  | { kind: "host-actions"; hostId: string }
  | null;

export interface MobileNavState {
  tab: MobileTab;
  /** Push pages rendered above the active tab (host edit, More sub-pages…). */
  stack: MobileScreen[];
  sheet: MobileSheet;
}

export const initialMobileNavState: MobileNavState = { tab: "hosts", stack: [], sheet: null };

/**
 * Hardware back: close sheet → pop stack → return to hosts tab → unhandled
 * (unhandled lets the system background the app).
 */
export function handleBack(s: MobileNavState): { state: MobileNavState; handled: boolean } {
  if (s.sheet) return { state: { ...s, sheet: null }, handled: true };
  if (s.stack.length > 0) return { state: { ...s, stack: s.stack.slice(0, -1) }, handled: true };
  if (s.tab !== "hosts") return { state: { ...s, tab: "hosts" }, handled: true };
  return { state: s, handled: false };
}
