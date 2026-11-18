import i18n from "@/i18n";
import { getPaneSessionIds, useLayoutStore } from "@/stores/layoutStore";
import { useLockNudgeStore } from "@/stores/lockNudgeStore";
import { APP_SOURCE, useNotificationStore } from "@/stores/notificationStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { useUIStore } from "@/stores/uiStore";
import { isSessionLocked } from "@/services/tabLock";
import { activateSessionTab, activateSplitTabPane } from "@/services/tabActivation";

export interface CloseResult { closed: string[]; kept: string[]; settled: Promise<void> }

/** Tear down a session: leave/stop any multiplayer connection, then disconnect and drop it. */
export function closeSession(sessionId: string): Promise<void> {
  const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  const mpConn = useTeamSessionStore.getState().connections[sessionId];
  if (mpConn) {
    if (mpConn.role === "host") useTeamSessionStore.getState().stopSharing(sessionId).catch(() => {});
    else useTeamSessionStore.getState().leaveSession(sessionId);
  }
  // disconnect() is async; removeSession() drops it synchronously so it can't linger as an ungrouped tab
  const disconnected = session?.type !== "multiplayer" && (session?.status === "connected" || session?.status === "connecting")
    ? useSessionStore.getState().disconnect(sessionId)
    : Promise.resolve();
  useSessionStore.getState().removeSession(sessionId);
  return disconnected;
}

export function closeSessionTabs(sessionIds: string[], opts: { reportKept?: boolean } = {}): CloseResult {
  const kept = sessionIds.filter(isSessionLocked);
  const closed = sessionIds.filter((id) => !kept.includes(id));
  const teardowns = closed.map((id) => {
    const disconnected = closeSession(id);
    useLayoutStore.getState().removeSession(id);
    return disconnected;
  });
  if (kept.length > 0) {
    useLockNudgeStore.getState().nudge(kept);
    if (opts.reportKept) {
      useNotificationStore.getState().addToast({
        source: APP_SOURCE,
        type: "toast",
        message: i18n.t("layout.titleBar.lock.keptToast", { count: kept.length }),
        severity: "info",
        duration: 3000,
      });
    }
  }
  if (useSessionStore.getState().sessions.length === 0) useUIStore.getState().leaveTerminal();
  return { closed, kept, settled: Promise.allSettled(teardowns).then(() => undefined) };
}

export function closeSplitTabSessions(tabId: string): CloseResult {
  const layout = useLayoutStore.getState();
  const wasActive = layout.splitTabActive && layout.activeSplitTabId === tabId;
  const tab = layout.splitTabs.find((candidate) => candidate.id === tabId);
  const result = closeSessionTabs(getPaneSessionIds(tab?.root ?? null), { reportKept: true });
  if (result.kept.length === 0) useLayoutStore.getState().closeSplitTab(tabId);
  else if (wasActive && useLayoutStore.getState().splitTabs.some((candidate) => candidate.id === tabId)) activateSplitTabPane(tabId);
  else if (wasActive) activateSessionTab(result.kept[0]);
  return result;
}
