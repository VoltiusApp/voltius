import type { TerminalSession } from "@/types";

/** Whether typed input can be sent to this session: a multiplayer view and a web page take none. */
export function acceptsTerminalInput(session: Pick<TerminalSession, "type">): boolean {
  return session.type !== "multiplayer" && session.type !== "web";
}

export function isRunnableSession(s: Pick<TerminalSession, "status" | "type">): boolean {
  return s.status === "connected" && acceptsTerminalInput(s);
}
