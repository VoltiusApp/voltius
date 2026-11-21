import type { TerminalSession } from "@/types";

/** Whether snippets, history and other typed input can be sent to this session: it is a terminal
 *  (SSH, local or serial). A multiplayer view and a web page are not. */
export function acceptsTerminalInput(session: Pick<TerminalSession, "type">): boolean {
  return session.type !== "multiplayer" && session.type !== "web";
}
