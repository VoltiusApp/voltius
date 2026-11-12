import { findSessionPane, getPaneSessionIds, useLayoutStore, type SplitTab } from "@/stores/layoutStore";
import { orderPinnedFirst } from "@/utils/pinnedOrder";
import { useSessionStore } from "@/stores/sessionStore";

export type TabTarget = { kind: "session" | "split"; id: string };

export function anyLocked(sessions: { id: string; locked?: boolean }[], ids: string[]): boolean {
  return sessions.some((s) => s.locked === true && ids.includes(s.id));
}

export function isSessionLocked(sessionId: string): boolean {
  return anyLocked(useSessionStore.getState().sessions, [sessionId]);
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

export function activeTabTarget(): TabTarget | null {
  const layout = useLayoutStore.getState();
  if (layout.splitTabActive && layout.activeSplitTabId) return { kind: "split", id: layout.activeSplitTabId };
  const id = useSessionStore.getState().activeSessionId;
  return id ? { kind: "session", id } : null;
}

export function tabTargetKey(target: TabTarget): string {
  return `${target.kind}:${target.id}`;
}

export function tabTargetLocked(target: TabTarget): boolean {
  if (target.kind === "session") return isSessionLocked(target.id);
  const tab = useLayoutStore.getState().splitTabs.find((candidate) => candidate.id === target.id);
  return tab ? splitTabLocked(tab) : false;
}

export function sessionsPinnedFirst<T extends { id: string }>(sessions: T[]): T[] {
  return orderPinnedFirst(sessions, (s) => isPinnedKey(titlebarKeyOfSession(s.id)));
}
