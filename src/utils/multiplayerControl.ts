import type { MultiplayerSessionState } from "@/stores/teamSessionStore";

export function holdsControl(c: Pick<MultiplayerSessionState, "myUserId" | "controlHolder">): boolean {
  return c.myUserId !== "" && c.controlHolder === c.myUserId;
}
