import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { broadcastSnippetInject } from "@/services/snippets";
import { buildDynamicContext, resolveSnippetPayload, type SnippetPendingInject } from "@/services/snippetRunCore";
import { parseVariables } from "@/services/snippetParser";
import { snippetScriptText } from "@/services/snippetSteps";
import { readClipboard } from "@/utils/clipboard";
import type { Snippet, TerminalSession } from "@/types";

/** A session a snippet can run into: connected and not a multiplayer mirror.
 *  Shared so the mobile target-picker gate and sheet stay in lockstep with the
 *  selection used here. */
export function isRunnableSession(s: Pick<TerminalSession, "status" | "type">): boolean {
  return s.status === "connected" && s.type !== "multiplayer";
}

export interface RunOpts {
  /** Called when the snippet has unfilled user variables; the surface shows a modal. */
  onNeedVars: (pending: SnippetPendingInject) => void;
}

/**
 * Resolve and inject a snippet into the given connected sessions. When user
 * variables need input, defers to `onNeedVars` (which must eventually inject the
 * resolved text into `pending.sessionIds`). Returns true if at least one target
 * was injected or deferred.
 */
export async function runSnippetIntoSessions(
  snippet: Snippet, sessionIds: string[], execute: boolean, opts: RunOpts,
): Promise<boolean> {
  const all = useSessionStore.getState().sessions;
  const targets = sessionIds
    .map((id) => all.find((s) => s.id === id))
    .filter((s): s is TerminalSession => !!s && isRunnableSession(s));
  if (targets.length === 0) return false;

  const { connections, teamConnections } = useConnectionStore.getState();
  const allConns = [...connections, ...Object.values(teamConnections).flat()];

  // Only read the clipboard when the snippet actually uses {{clipboard}} — otherwise
  // every run would trigger a clipboard-permission prompt (notably on Android).
  let clipboard = "";
  if (parseVariables(snippetScriptText(snippet)).some((v) => v.dynamic && v.name === "clipboard")) {
    try { clipboard = await readClipboard(); } catch { /* permission denied */ }
  }

  const ctx = buildDynamicContext(targets[0], allConns, clipboard);
  const r = resolveSnippetPayload(snippet, ctx);
  useSnippetStore.getState().trackUsed(snippet.id);

  if (r.missing.length > 0) {
    opts.onNeedVars({
      snippet, userVars: r.userVars, partialTemplate: r.partialTemplate,
      initialValues: r.initialValues, execute, sessionIds: targets.map((t) => t.id),
    });
    return true;
  }

  await Promise.all(
    targets.map((t) => broadcastSnippetInject(t.id, t.type, r.payload, execute).catch(console.error)),
  );
  return true;
}

/**
 * Run a snippet into the active connected session (execute). `sessionId`
 * optionally targets a specific session. Variable snippets route through the
 * GLOBAL pending-inject modal (mounted in App.tsx).
 */
export function runSnippetIntoActiveSession(snippet: Snippet, sessionId?: string): boolean {
  const sessions = useSessionStore.getState().sessions;
  const active = sessionId
    ? sessions.find((s) => s.id === sessionId && isRunnableSession(s))
    : sessions.find(isRunnableSession);
  if (!active) return false;
  void runSnippetIntoSessions(snippet, [active.id], true, {
    onNeedVars: (p) => useSnippetStore.getState().setGlobalPendingInject(p),
  });
  return true;
}
