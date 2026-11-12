import { findSessionPane, getPaneSessionIds, useLayoutStore, type SplitTab } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";

export type TabTarget = { kind: "session" | "split"; id: string };

export function isSessionLocked(sessionId: string): boolean {
  return useSessionStore.getState().sessions.some((s) => s.id === sessionId && s.locked === true);
}

export function splitTabLocked(tab: SplitTab): boolean {
  return getPaneSessionIds(tab.root).some(isSessionLocked);
}

export function setTabLocked(target: TabTarget, locked: boolean): void {
  const ids = target.kind === "session"
    ? [target.id]
    : getPaneSessionIds(useLayoutStore.getState().splitTabs.find((tab) => tab.id === target.id)?.root ?? null);
  useSessionStore.getState().setSessionsLocked(ids, locked);
}

export function titlebarKeyOfSession(sessionId: string): string {
  const pane = findSessionPane(useLayoutStore.getState().splitTabs, sessionId);
  return pane ? `split:${pane.tabId}` : `session:${sessionId}`;
}

export function isPinnedKey(key: string): boolean {
  return useLayoutStore.getState().pinnedKeys.includes(key);
}
