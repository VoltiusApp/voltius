import type { MultiplayerSessionState } from "@/stores/teamSessionStore";

export function holdsControl(c: Pick<MultiplayerSessionState, "myUserId" | "controlHolder">): boolean {
  return c.myUserId !== "" && c.controlHolder === c.myUserId;
}

export function guestCanType(c: Pick<MultiplayerSessionState, "role" | "ended" | "myUserId" | "controlHolder">): boolean {
  return c.role === "guest" && !c.ended && holdsControl(c);
}

/** Why a guest's typing goes nowhere right now (an i18n key), or null when it reaches the host. */
export function guestTypingBlockedKey(c: Parameters<typeof guestCanType>[0] | undefined): string | null {
  if (!c || c.role !== "guest" || guestCanType(c)) return null;
  return c.ended ? "terminal.multiplayerBar.typingEnded" : "terminal.multiplayerBar.typingNeedsControl";
}
