import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { makeGate, objectOp } from "./helpers";

export const SNIPPET_RUN_PERMISSIONS = ["snippets:read", "snippets:run", "audit"] as const;

const target = z.object({
  session_id: z.string().optional(),
  connection_id: z.string().optional(),
});

export function buildSnippetRunTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);
  return [
    {
      name: "snippet_run",
      description:
        "Run a saved snippet against one or more targets — an open session, or a saved connection "
        + "which is connected first (its new session ids come back in `opened_session_ids`). Any "
        + "{{variable}} the snippet uses must be supplied in `variables`, or the call is refused "
        + "naming what is missing. Script steps are injected into a terminal, so the result reports "
        + "per-target success, not command output: read that with read_terminal on the session ids "
        + "involved. Pass `dry_run` to preview the resolved steps without running them — variables "
        + "you did not supply stay as `{{name}}`, and `{{clipboard}}` is always shown empty in a "
        + "preview even if the real run would fill it.",
      risk: "prompt",
      schema: z.object({
        snippet_id: z.string(),
        targets: z.array(target).min(1),
        variables: z.record(z.string(), z.string()).optional(),
        dry_run: z.boolean().optional(),
      }),
      execute: async (raw) =>
        op("snippet_run", "agent.command_run", {}, raw, (a) =>
          ports.api.snippets.run({
            snippetId: a.snippet_id as string,
            targets: a.targets as { session_id?: string; connection_id?: string }[],
            variables: a.variables as Record<string, string> | undefined,
            dryRun: a.dry_run as boolean | undefined,
          })),
    },
  ];
}
