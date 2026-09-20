import { useLayoutStore } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { goToTerminal } from "@/services/launch";
import { activateSessionTab } from "@/services/tabActivation";
import type { TerminalSession } from "@/types";

export function openInSplit(sessionId: string, members: TerminalSession[], shownId: string): void {
  const baseId = shownId !== sessionId ? shownId : members.find((member) => member.id !== sessionId)?.id;
  if (!baseId) return;
  useLayoutStore.getState().createSplitTab(baseId, sessionId, "right");
  useSessionStore.getState().setActive(sessionId);
  goToTerminal();
}

/** The panel always follows the focused session, so pinning a host's list means focusing it first. */
export function pinHostList(shownId: string): void {
  activateSessionTab(shownId);
  useUIStore.getState().setHostPanelPinned(true);
}
