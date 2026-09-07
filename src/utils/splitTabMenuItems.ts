import type { TFunction } from "i18next";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { getPaneLeaves, useLayoutStore, type SplitTab } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { sessionLabel } from "@/utils/sessionLabel";

/**
 * Tab-scope entries for a unified split tab. Everything that acts on a single
 * session (duplicate, reconnect, close pane) stays on the pane header, where
 * the target is unambiguous — a split tab holds several of them.
 *
 * Every layout mutation below targets the *active* split tab, so each one
 * activates this tab first.
 */
export function splitTabMenuItems({
  tab,
  t,
  onFocusPane,
  onClose,
  onRename,
}: {
  tab: SplitTab;
  t: TFunction;
  /** Bring a pane of this tab to the front. */
  onFocusPane: (paneId: string) => void;
  /** Close the tab and every session in it. */
  onClose: () => void;
  /** Start the inline editor on the tab itself. */
  onRename: () => void;
}): ContextMenuItem[] {
  const leaves = getPaneLeaves(tab.root);
  const { sessions } = useSessionStore.getState();
  const paneLabel = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    return session ? sessionLabel(session) : t("layout.titleBar.splitFallback");
  };

  return [
    {
      label: t("layout.titleBar.splitMenu.rename"),
      icon: "lucide:pencil",
      onClick: onRename,
    },
    {
      label: tab.broadcastActive
        ? t("layout.titleBar.splitMenu.broadcastOff")
        : t("layout.titleBar.splitMenu.broadcastOn"),
      icon: tab.broadcastActive ? "lucide:radio-tower" : "lucide:radio",
      onClick: () => {
        useLayoutStore.getState().activateSplitTab(tab.id);
        useLayoutStore.getState().toggleBroadcast();
      },
    },
    {
      label: t("layout.titleBar.splitMenu.panes"),
      icon: "lucide:layout-dashboard",
      // Numbered because a split of two shells on the same host would otherwise
      // list the same label twice.
      children: leaves.map((leaf, index) => ({
        label: t("layout.titleBar.splitMenu.pane", { index: index + 1, name: paneLabel(leaf.sessionId) }),
        icon: leaf.id === tab.activePaneId ? "lucide:dot" : "lucide:square",
        onClick: () => onFocusPane(leaf.id),
      })),
    },
    {
      label: t("layout.titleBar.splitMenu.splitApart"),
      icon: "lucide:between-horizontal-start",
      onClick: () => splitApart(tab.id),
    },
    {
      label: t("layout.titleBar.splitMenu.closeTab", { count: leaves.length }),
      icon: "lucide:x",
      danger: true,
      divider: true,
      onClick: onClose,
    },
  ];
}

/**
 * Every pane becomes a tab of its own. Detaching the second-to-last pane
 * dissolves the split tab and hands the survivor back to the titlebar, so the
 * loop ends on a pane id the store no longer knows — a no-op detach.
 */
function splitApart(tabId: string): void {
  const layout = useLayoutStore.getState();
  layout.activateSplitTab(tabId);
  for (const leaf of getPaneLeaves(useLayoutStore.getState().root)) {
    useLayoutStore.getState().detachPane(leaf.id);
  }
}
