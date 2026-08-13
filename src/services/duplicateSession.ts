import { findLeafBySession, useLayoutStore, type SplitPosition, type SplitTab } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useTerminalCwdStore } from "@/stores/terminalCwdStore";
import { matchShortcut } from "@/stores/shortcutStore";
import { goToTerminal } from "@/services/launch";
import type { TerminalSession } from "@/types";

export type DuplicateTarget = "tab" | SplitPosition;

/** A serial port takes one session, multiplayer is joined not owned, and a container exec has no connection of its own. */
export function canDuplicateSession(session: TerminalSession | undefined): boolean {
  if (!session || session.containerExec) return false;
  return session.type === "ssh" || session.type === "local";
}

export function findSessionPane(splitTabs: SplitTab[], sessionId: string): { tabId: string; paneId: string } | null {
  for (const tab of splitTabs) {
    const leaf = findLeafBySession(tab.root, sessionId);
    if (leaf) return { tabId: tab.id, paneId: leaf.id };
  }
  return null;
}

/** Where a split duplicate attaches. Defaults to the duplicated session's own pane. */
export type DuplicateAnchor = { paneId: string } | { sessionId: string };

function placeSplit(anchor: DuplicateAnchor, newSessionId: string, position: SplitPosition): void {
  const layout = useLayoutStore.getState();
  if ("paneId" in anchor) {
    layout.splitPane(anchor.paneId, newSessionId, position);
    return;
  }
  const existing = findSessionPane(layout.splitTabs, anchor.sessionId);
  if (!existing) {
    layout.createSplitTab(anchor.sessionId, newSessionId, position);
    return;
  }
  if (existing.tabId !== layout.activeSplitTabId) layout.activateSplitTab(existing.tabId);
  useLayoutStore.getState().splitPane(existing.paneId, newSessionId, position);
}

/**
 * Directory the duplicate opens in: the source session's, as last reported by
 * OSC 7 (so it needs shell integration). Undefined falls back to the host's
 * default directory. A full-screen program holds the shell past its last prompt,
 * so the value is where it was launched from — which is what a duplicate wants.
 */
function inheritedCwd(sessionId: string): string | undefined {
  return useTerminalCwdStore.getState().cwds[sessionId];
}

/** Second session on the same host. Returns the new session id, or null when it can't be duplicated. */
export function duplicateSession(sessionId: string, target: DuplicateTarget, anchor?: DuplicateAnchor): string | null {
  const store = useSessionStore.getState();
  const session = store.sessions.find((s) => s.id === sessionId);
  if (!session || !canDuplicateSession(session)) return null;

  const cwd = inheritedCwd(sessionId);

  // begin* return synchronously so the pane appears before the SSH handshake.
  const newSessionId = session.type === "local"
    ? store.beginLocalSession(session.localShell, cwd)
    : store.beginSession(session.connectionId, cwd);

  if (target === "tab") useLayoutStore.getState().setSplitTabActive(false);
  else placeSplit(anchor ?? { sessionId }, newSessionId, target);

  store.setActive(newSessionId);
  goToTerminal();
  return newSessionId;
}

const DUPLICATE_SHORTCUTS = [
  ["duplicate-session", "tab"],
  ["duplicate-session-split", "right"],
] as const;

/** Shared by the window handler and xterm's key handler. Returns true when the event was a duplicate shortcut. */
export function handleDuplicateShortcut(e: KeyboardEvent, sessionId: string | null): boolean {
  for (const [id, target] of DUPLICATE_SHORTCUTS) {
    if (!matchShortcut(id, e)) continue;
    if (e.type === "keydown" && sessionId) duplicateSession(sessionId, target);
    return true;
  }
  return false;
}
