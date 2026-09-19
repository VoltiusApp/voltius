import { findLeaf, firstLeaf, useLayoutStore } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";

export function activateSessionTab(sessionId: string): void {
  useUIStore.getState().setSftpPanelOpen(false);
  useLayoutStore.getState().setSplitTabActive(false);
  useSessionStore.getState().setActive(sessionId);
  useUIStore.getState().setActiveNav("terminal");
}

export function activateSplitTabPane(tabId: string, paneId?: string): void {
  useUIStore.getState().setSftpPanelOpen(false);
  useLayoutStore.getState().activateSplitTab(tabId);
  if (paneId) {
    useLayoutStore.getState().setActivePane(paneId);
    // A maximized sibling would otherwise keep the whole tab and hide the picked pane.
    if (useLayoutStore.getState().maximizedPaneId) useLayoutStore.getState().setMaximized(paneId);
  }
  const layout = useLayoutStore.getState();
  const leaf = findLeaf(layout.root, layout.activePaneId) ?? firstLeaf(layout.root);
  if (leaf) useSessionStore.getState().setActive(leaf.sessionId);
  useUIStore.getState().setActiveNav("terminal");
}
