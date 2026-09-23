import type { TerminalSession } from "@/types";

export function needsConnectionOverlay(session: TerminalSession): boolean {
  if (session.type === "multiplayer") return false;
  return session.status === "connecting" || session.status === "error";
}
