import { broadcastActiveForSession } from "@/stores/layoutStore";
import { broadcastTargets } from "@/services/broadcast";
import { sendSessionInput } from "@/services/sessionInput";
import type { TerminalSession } from "@/types";

type SessionType = TerminalSession["type"];

/** Insert pastes through the session's terminal (bracketed paste, input gate,
 *  broadcast fan-out via onData); execute writes the command plus the run newline. */
export async function snippetInject(
  sessionId: string,
  sessionType: SessionType,
  text: string,
  execute: boolean,
): Promise<void> {
  if (!execute) {
    // Lazy: sessionStore imports this module and useTerminal imports sessionStore.
    const { pasteToSession } = await import("@/services/terminalPaste");
    await pasteToSession(sessionId, text);
    return;
  }
  await sendSessionInput(sessionId, sessionType, new TextEncoder().encode(`${text}\n`));
}

export async function broadcastSnippetInject(
  activeSessionId: string,
  activeSessionType: SessionType,
  text: string,
  execute: boolean,
): Promise<void> {
  if (execute && broadcastActiveForSession(activeSessionId)) {
    await Promise.all(
      broadcastTargets().map((target) => snippetInject(target.id, target.type, text, execute)),
    );
    return;
  }

  return snippetInject(activeSessionId, activeSessionType, text, execute);
}
