import { useLayoutStore } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { goToTerminal } from "@/services/launch";
import type { TerminalSession } from "@/types";

export function openInSplit(sessionId: string, members: TerminalSession[], shownId: string): void {
  const baseId = shownId !== sessionId ? shownId : members.find((member) => member.id !== sessionId)?.id;
  if (!baseId) return;
  useLayoutStore.getState().createSplitTab(baseId, sessionId, "right");
  useSessionStore.getState().setActive(sessionId);
  goToTerminal();
}
