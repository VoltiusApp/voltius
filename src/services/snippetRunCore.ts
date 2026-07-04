import type { Connection } from "@/types";
import type { Snippet } from "@/types";
import type { ParsedVariable, DynamicContext } from "@/services/snippetParser";
import {
  parseVariables, needsUserInput, buildDynamicValues, buildDefaultValues, resolveTemplate,
} from "./snippetParser.ts";
import { snippetScriptText } from "@/services/snippetSteps";

export interface SnippetPendingInject {
  snippet: Snippet;
  userVars: ParsedVariable[];
  partialTemplate: string;
  initialValues: Record<string, string>;
  execute: boolean;
  sessionIds: string[];
}

export interface ResolvedSnippet {
  payload: string;
  partialTemplate: string;
  userVars: ParsedVariable[];
  initialValues: Record<string, string>;
  missing: ParsedVariable[];
}

/**
 * Resolve dynamic vars; compute the resolved payload text and which user vars
 * still need input. Pure. The execution newline is NOT added here — the backend
 * `snippet_inject` appends it when the `execute` flag is set, so payload is the
 * bare resolved text in both insert and execute modes.
 */
export function resolveSnippetPayload(
  snippet: Snippet,
  ctx: DynamicContext,
): ResolvedSnippet {
  const text = snippetScriptText(snippet);
  const vars = parseVariables(text);
  const dynValues = buildDynamicValues(vars, ctx);
  const partialTemplate = resolveTemplate(text, dynValues);
  const userVars = vars.filter((v) => !v.dynamic);
  const initialValues = buildDefaultValues(userVars);
  const missing = userVars.filter((v) => needsUserInput(v));
  const payload = resolveTemplate(partialTemplate, initialValues);
  return { payload, partialTemplate, userVars, initialValues, missing };
}

/** Build the dynamic-variable context from the (first) target session. Pure. */
export function buildDynamicContext(
  session: { type: string; connectionId: string; connectionName: string } | undefined,
  connections: Connection[],
  clipboard = "",
): DynamicContext {
  if (!session || session.type === "local") {
    return { connectionHost: "localhost", connectionUsername: "local", connectionName: "Local Shell", clipboard };
  }
  const conn = connections.find((c) => c.id === session.connectionId);
  return {
    connectionHost: conn?.host ?? "",
    connectionUsername: conn?.username ?? "",
    connectionName: session.connectionName,
    clipboard,
  };
}
