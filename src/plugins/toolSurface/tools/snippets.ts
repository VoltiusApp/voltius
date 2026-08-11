import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import type { PluginSnippetInput } from "@/plugins/api";
import { makeGate, objectOp, toPatch } from "./helpers";

export const SNIPPET_PERMISSIONS = ["snippets:read", "snippets:write", "audit"] as const;

/**
 * A snippet's steps, all three kinds the app runs.
 *
 * A `snippet` step runs another saved snippet by id, so a snippet can compose
 * others — the ids come from snippet_list.
 */
const step = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("script"), content: z.string() }),
  z.object({
    kind: z.literal("transfer"),
    from: z.enum(["local", "remote"]),
    to: z.enum(["local", "remote"]),
    from_path: z.string(),
    to_path: z.string(),
    is_dir: z.boolean(),
    mode: z.enum(["copy", "move"]),
    on_conflict: z.enum(["overwrite", "skip", "fail"]),
  }),
  z.object({ kind: z.literal("snippet"), snippet_id: z.string() }),
]);

const SNIPPET_INPUT = {
  name: z.string(),
  steps: z.array(step),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  favorite: z.boolean().optional(),
  only_for_connection_tags: z.array(z.string()).optional(),
  only_for_distros: z.array(z.string()).optional(),
  folder_id: z.string().optional(),
  vault_id: z.string().optional(),
};

export function buildSnippetTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);
  return [
    {
      name: "snippet_list",
      description:
        "List the saved snippets — the command sequences the user runs on hosts — with their steps, "
        + "tags, and the vault and folder each is filed in.",
      risk: "auto",
      schema: z.object({}),
      execute: async () => ports.api.snippets.list(),
    },
    {
      name: "snippet_create",
      description:
        "Save a new snippet. `steps` run in order: a \"script\" step is shell text, a \"transfer\" "
        + "step copies a path between local and remote, and a \"snippet\" step runs another saved "
        + "snippet by id. Returns the new snippet.",
      risk: "prompt",
      schema: z.object(SNIPPET_INPUT),
      execute: async (raw) =>
        op("snippet_create", "agent.object_created", { objectType: "snippet" }, raw, (a) =>
          ports.api.snippets.create(a as unknown as PluginSnippetInput)),
    },
    {
      name: "snippet_update",
      description:
        "Change fields on a saved snippet. Only the fields given are altered; `steps` replaces the "
        + "whole sequence. A snippet in a team vault cannot be changed.",
      risk: "prompt",
      // The two required fields of a create are optional in a patch; the rest of
      // SNIPPET_INPUT is optional already.
      schema: z.object({
        ...SNIPPET_INPUT,
        id: z.string(),
        name: z.string().optional(),
        steps: z.array(step).optional(),
      }),
      execute: async (raw) =>
        op("snippet_update", "agent.object_updated", { objectType: "snippet", objectId: String(raw.id) }, raw, (a) =>
          ports.api.snippets.update(String(a.id), toPatch<PluginSnippetInput>(a))),
    },
    {
      name: "snippet_delete",
      description:
        "Delete a saved snippet by id. Cannot be undone. A snippet in a team vault cannot be deleted.",
      risk: "prompt",
      schema: z.object({ id: z.string() }),
      execute: async (raw) =>
        op("snippet_delete", "agent.object_deleted", { objectType: "snippet", objectId: String(raw.id) }, raw, (a) =>
          ports.api.snippets.delete(String(a.id))),
    },
  ];
}
