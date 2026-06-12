import {
  readWorkspaceSnapshot,
  clearWorkspaceSnapshot,
  startWorkspaceSnapshotSync,
} from "./workspaceSnapshotStore";
import { getToggle } from "./toggleSettingsStore";
import { useSessionStore } from "./sessionStore";
import { useLayoutStore, getPaneSessionIds, type SplitTab } from "./layoutStore";
import { useUIStore } from "./uiStore";
import { localConnect } from "@/services/local";
import { setRestoreScrollOffset } from "@/hooks/useTerminal";
import type { SerialConnectParams, TerminalSession } from "@/types";
import type { SnapshotSession } from "./workspaceSnapshotCore";

function toTerminalSession(s: SnapshotSession): TerminalSession {
  return {
    id: s.id,
    connectionId: s.connectionId,
    connectionName: s.connectionName,
    status: "connecting",
    persist: s.persist,
    type: s.type,
    encoding: s.encoding,
    localShell: s.localShell,
    serialConfig: s.serialConfig as SerialConnectParams | undefined,
  };
}

/** Two animation frames + a grace delay: lets React mount the (invisible)
 * terminal views and their async tauri `listen()` output subscriptions
 * register before reconnect output — including history replay — flows. */
function waitForTerminalMount(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 150)));
  });
}

let ran = false;

/**
 * One-shot launch restore. Always ends by starting the snapshot sync —
 * never before the restore decision, so the boot-empty session store can't
 * clobber the snapshot we're about to read.
 */
export async function restoreWorkspaceOnLaunch(): Promise<void> {
  if (ran) return;
  ran = true;

  if (!getToggle("restore-workspace")) {
    clearWorkspaceSnapshot();
    startWorkspaceSnapshotSync();
    return;
  }

  const snapshot = readWorkspaceSnapshot();
  if (!snapshot || snapshot.sessions.length === 0 || useSessionStore.getState().sessions.length > 0) {
    startWorkspaceSnapshotSync();
    return;
  }

  // 1. Tabs + layout reappear immediately, all "connecting".
  useSessionStore
    .getState()
    .restoreSessions(snapshot.sessions.map(toTerminalSession), snapshot.activeSessionId);
  useLayoutStore.getState().hydrate({
    splitTabs: snapshot.layout.splitTabs as SplitTab[],
    activeSplitTabId: snapshot.layout.activeSplitTabId,
    splitTabActive: snapshot.layout.splitTabActive,
    titlebarOrder: snapshot.layout.titlebarOrder,
  });

  // Prune layout leaves whose sessions weren't snapshotable (e.g. a
  // multiplayer pane inside a split).
  const restoredIds = new Set(snapshot.sessions.map((s) => s.id));
  const layout = useLayoutStore.getState();
  for (const tab of layout.splitTabs) {
    for (const sid of getPaneSessionIds(tab.root)) {
      if (!restoredIds.has(sid)) useLayoutStore.getState().removeSession(sid);
    }
  }

  useUIStore.getState().setActiveNav("terminal");
  useUIStore.getState().setSidebarOpen(false);

  // 2. Wait for terminals to mount, then track state changes from here on.
  await waitForTerminalMount();
  startWorkspaceSnapshotSync();

  // 3. Reconnect everything in parallel. Persistent SSH re-attaches its tmux
  // (same session id → same key) and replays history (restore flag). Vault
  // unlock happens lazily inside credential resolution; failures land in the
  // existing per-session error overlay (retry affordances included).
  const { reconnect, markConnected, markError } = useSessionStore.getState();
  for (const s of snapshot.sessions) {
    if (s.scrollLinesFromBottom) setRestoreScrollOffset(s.id, s.scrollLinesFromBottom);
  }
  await Promise.allSettled(
    snapshot.sessions.map(async (s) => {
      if (s.type === "ssh" || s.type === "serial") {
        await reconnect(s.id, { restore: s.persist });
      } else {
        try {
          await localConnect(s.id, 80, 24, s.localShell, s.cwd, getToggle("shell-integration"));
          markConnected(s.id);
        } catch (err) {
          markError(s.id, err instanceof Error ? err.message : String(err));
        }
      }
    }),
  );
}
