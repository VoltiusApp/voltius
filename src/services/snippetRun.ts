import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { broadcastSnippetInject } from "@/services/snippets";
import {
  parseVariables, needsUserInput, buildDynamicValues, buildDefaultValues,
  resolveTemplate, type DynamicContext,
} from "@/services/snippetParser";
import type { Snippet, TerminalSession } from "@/types";

/** A session a snippet can be run into: connected and not a multiplayer mirror.
 *  Shared so the mobile target-picker gate and sheet stay in lockstep with the
 *  selection used here. */
export function isRunnableSession(s: Pick<TerminalSession, "status" | "type">): boolean {
  return s.status === "connected" && s.type !== "multiplayer";
}

/**
 * Run a snippet into the active connected session (resolving dynamic vars; user
 * vars route through the global SnippetVariableModal). Returns false when no
 * connected session exists. Logic extracted from OmniSearch so desktop palette
 * and the mobile snippets screen share one implementation.
 *
 * `sessionId` optionally targets a specific connected session (used by the
 * mobile snippet-target picker when several sessions are connected). When
 * omitted — every existing caller — the first connected non-multiplayer session
 * is used, preserving the original behavior exactly.
 */
export function runSnippetIntoActiveSession(snippet: Snippet, sessionId?: string): boolean {
  const sessions = useSessionStore.getState().sessions;
  const activeSession = sessionId
    ? sessions.find((s) => s.id === sessionId && isRunnableSession(s))
    : sessions.find(isRunnableSession);
  if (!activeSession) return false;

  const { connections, teamConnections } = useConnectionStore.getState();
  const all = [...connections, ...Object.values(teamConnections).flat()];
  const conn = all.find((c) => c.id === activeSession.connectionId);
  const ctx: DynamicContext = activeSession.type === "local"
    ? { connectionHost: "localhost", connectionUsername: "local", connectionName: "Local Shell" }
    : { connectionHost: conn?.host ?? "", connectionUsername: conn?.username ?? "", connectionName: activeSession.connectionName };

  const allVars = parseVariables(snippet.content);
  const dynamicValues = buildDynamicValues(allVars, ctx);
  const userVars = allVars.filter((v) => !v.dynamic);
  const defaultValues = buildDefaultValues(userVars);
  const partialTemplate = resolveTemplate(snippet.content, dynamicValues);

  useSnippetStore.getState().trackUsed(snippet.id);

  if (userVars.some(needsUserInput)) {
    useSnippetStore.getState().setGlobalPendingInject({ snippet, userVars, partialTemplate, initialValues: defaultValues });
  } else {
    const resolved = resolveTemplate(partialTemplate, defaultValues);
    broadcastSnippetInject(activeSession.id, activeSession.type, resolved, true).catch(console.error);
  }
  return true;
}
