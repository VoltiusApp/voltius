import { broadcastActiveForSession } from "@/stores/layoutStore";
import { broadcastTargets, hasInputControl } from "@/services/broadcast";
import { sendSessionInput } from "@/services/sessionInput";
import type { TerminalSession } from "@/types";

type SessionType = TerminalSession["type"];
type InjectTarget = Pick<TerminalSession, "id" | "type">;

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
  if (!hasInputControl(sessionId)) return;
  await sendSessionInput(sessionId, sessionType, new TextEncoder().encode(`${text}\n`));
}

export async function broadcastSnippetInject(
  targets: InjectTarget[],
  text: string,
  execute: boolean,
): Promise<void> {
  const writable = targets.filter((t) => hasInputControl(t.id));
  const direct = writable.filter((t) => !broadcastActiveForSession(t.id));
  const broadcasting = writable.find((t) => broadcastActiveForSession(t.id));
  // An inserted paste fans out through its terminal's onData, so it goes into one broadcast pane only.
  const fanOut = !broadcasting ? [] : execute ? broadcastTargets() : [broadcasting];

  await Promise.all([...direct, ...fanOut].map((t) => snippetInject(t.id, t.type, text, execute)));
}
