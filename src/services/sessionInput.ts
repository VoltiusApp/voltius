import { localResize, localSendInput } from "@/services/local";
import { serialWrite } from "@/services/serial";
import { sshResize, sshSendInput } from "@/services/ssh";

/**
 * Write raw bytes to a session's transport. The single fan-out: the terminal's
 * keystroke path, PluginAPI's sendCommand and PluginAPI's sendInput all come
 * through here, so a transport added or fixed once is added or fixed everywhere.
 *
 * Rejects on transport failure. Callers that must not fail on a dropped
 * keystroke (the interactive terminal) swallow it at their own call site — a
 * swallow inside here would hide a failed MCP write.
 */
export async function sendSessionInput(
  sessionId: string,
  sessionType: "ssh" | "local" | "serial",
  data: Uint8Array,
): Promise<void> {
  if (sessionType === "local") return localSendInput(sessionId, data);
  if (sessionType === "serial") return serialWrite(sessionId, data);
  return sshSendInput(sessionId, data);
}

/**
 * Push a terminal's dimensions to its transport. Same fan-out rationale as
 * `sendSessionInput`: every resize path (xterm's onResize, the force-fit after
 * a session becomes active, the connect transition) routes through here.
 *
 * Serial has no window size — it resolves to a no-op rather than a throw, so
 * callers never need to special-case the transport.
 */
export async function sendSessionResize(
  sessionId: string,
  sessionType: "ssh" | "local" | "serial",
  cols: number,
  rows: number,
): Promise<void> {
  if (sessionType === "local") return localResize(sessionId, cols, rows);
  if (sessionType === "ssh") return sshResize(sessionId, cols, rows);
}
