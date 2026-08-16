import type { UnlistenFn } from "@tauri-apps/api/event";
import { localResize, localSendInput, onLocalOutput } from "@/services/local";
import { onSerialOutput, serialWrite } from "@/services/serial";
import { onSshOutput, sshResize, sshSendInput } from "@/services/ssh";
import type { TerminalSession } from "@/types";

/**
 * Write raw bytes to a session's transport. The single fan-out: the terminal's
 * keystroke path, PluginAPI's sendCommand and PluginAPI's sendInput all come
 * through here, so a transport added or fixed once is added or fixed everywhere.
 *
 * Rejects on transport failure. Callers that must not fail on a dropped
 * keystroke (the interactive terminal) swallow it at their own call site — a
 * swallow inside here would hide a failed MCP write.
 *
 * A `multiplayer` tab holds no transport of its own — its keystrokes travel the
 * relay — so it is a no-op here rather than a misrouted SSH write.
 */
export async function sendSessionInput(
  sessionId: string,
  sessionType: TerminalSession["type"],
  data: Uint8Array,
): Promise<void> {
  if (sessionType === "local") return localSendInput(sessionId, data);
  if (sessionType === "serial") return serialWrite(sessionId, data);
  if (sessionType === "multiplayer") return;
  return sshSendInput(sessionId, data);
}

/**
 * Subscribe to a session's output events. The read-side twin of
 * `sendSessionInput`: the multiplayer host broadcast and PluginAPI's
 * `terminal.onOutput` both come through here, so a transport is wired for
 * every consumer at once rather than per call site — a shared local shell
 * relayed nothing to its guests because one such site listened only for
 * `ssh-output`.
 *
 * A `multiplayer` tab is a guest's view of someone else's session: it has no
 * local transport to listen to, so it resolves to a no-op unsubscribe.
 */
export async function onSessionOutput(
  sessionId: string,
  sessionType: TerminalSession["type"],
  callback: (data: Uint8Array) => void,
): Promise<UnlistenFn> {
  if (sessionType === "local") return onLocalOutput(sessionId, callback);
  if (sessionType === "serial") return onSerialOutput(sessionId, callback);
  if (sessionType === "multiplayer") return () => {};
  return onSshOutput(sessionId, callback);
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
  sessionType: TerminalSession["type"],
  cols: number,
  rows: number,
): Promise<void> {
  if (sessionType === "local") return localResize(sessionId, cols, rows);
  if (sessionType === "ssh") return sshResize(sessionId, cols, rows);
}
