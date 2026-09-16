import { getPaneSessionIds, useLayoutStore } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import type { TerminalSession } from "@/types";

/**
 * The panes a broadcast actually reaches, in pane order. Only meaningful once
 * `broadcastActiveForSession` is true — callers still send to the origin session
 * alone when it is not.
 *
 * Skipped: a pane that is not connected, a multiplayer viewer pane (its input
 * belongs to the host), and any session where someone else currently holds
 * control — writing there would type into a shell the user does not own.
 */
export function broadcastTargets(): TerminalSession[] {
  const sessions = useSessionStore.getState().sessions;
  const targets: TerminalSession[] = [];
  for (const targetId of getPaneSessionIds(useLayoutStore.getState().root)) {
    const target = sessions.find((s) => s.id === targetId);
    if (!target || target.status !== "connected" || target.type === "multiplayer") continue;
    if (!hasInputControl(target.id)) continue;
    targets.push(target);
  }
  return targets;
}

/** False while another multiplayer participant holds control of the session. */
export function hasInputControl(sessionId: string): boolean {
  const mpState = useTeamSessionStore.getState().connections[sessionId];
  return !mpState || mpState.controlHolder === "" || mpState.controlHolder === mpState.myUserId;
}
