import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import type { PluginObjectMoveInput } from "@/plugins/api";
import { makeGate, objectOp } from "./helpers";

export const OBJECT_PERMISSIONS = [
  "connections:write", "keys:write", "identities:write",
  "snippets:write", "port_forwarding:write", "folders:write", "audit",
] as const;

const schema = z.object({
  ids: z.array(z.string()).min(1),
  folder_id: z.string().nullable().optional(),
  vault_id: z.string().nullable().optional(),
  allow_cross_vault: z.boolean().optional(),
});

const toInput = (a: Record<string, unknown>): PluginObjectMoveInput => ({
  ids: a.ids as string[],
  folderId: (a.folder_id as string | null | undefined) ?? null,
  vaultId: (a.vault_id as string | null | undefined) ?? null,
  allowCrossVault: a.allow_cross_vault as boolean | undefined,
});

export function buildObjectTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);
  return [
    {
      name: "object_move",
      description:
        "Move objects — connections, keys, identities, snippets or port forwarding rules, folders "
        + "included — into another folder and/or vault, using the same paste path as the app's UI. "
        + "Moving into a vault other than the objects' own is refused unless allow_cross_vault is "
        + "true; the refusal names what would move and where. Runs immediately; your own client is "
        + "responsible for approval.",
      risk: "prompt",
      schema,
      execute: async (raw) =>
        op("object_move", "agent.object_updated", { objectType: "object" }, raw, (a) =>
          ports.api.objects.move(toInput(a))),
    },
    {
      name: "object_copy",
      description:
        "Duplicate objects — connections, keys, identities, snippets or port forwarding rules, "
        + "folders included — into another folder and/or vault, using the same paste path as the "
        + "app's UI. Copying out of a team vault is refused, and copying into a vault other than the "
        + "objects' own is refused unless allow_cross_vault is true; the refusal names what would be "
        + "copied and where. Runs immediately; your own client is responsible for approval.",
      risk: "prompt",
      schema,
      execute: async (raw) =>
        op("object_copy", "agent.object_created", { objectType: "object" }, raw, (a) =>
          ports.api.objects.copy(toInput(a))),
    },
  ];
}
