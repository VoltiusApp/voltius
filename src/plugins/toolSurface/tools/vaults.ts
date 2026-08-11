import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { makeGate, objectOp } from "./helpers";

export const VAULT_PERMISSIONS = ["vaults:read", "vaults:write", "audit"] as const;

export function buildVaultTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);
  return [
    {
      name: "vault_list",
      description:
        "List the vaults that hosts, keys, identities, port forwards and snippets are filed into. "
        + "A vault marked team is shared and cannot be changed from here.",
      risk: "auto",
      schema: z.object({}),
      execute: async () => ports.api.vaults.list(),
    },
    {
      name: "vault_create",
      description: "Create a vault. Returns the new vault's id.",
      risk: "prompt",
      schema: z.object({ name: z.string() }),
      execute: async (raw) =>
        op("vault_create", "agent.object_created", { objectType: "vault" }, raw, async (a) =>
          ports.api.vaults.create(String(a.name))),
    },
    {
      name: "vault_rename",
      description: "Rename a vault. Team vaults are refused.",
      risk: "prompt",
      schema: z.object({ id: z.string(), name: z.string() }),
      execute: async (raw) =>
        op("vault_rename", "agent.object_updated", { objectType: "vault", objectId: String(raw.id) }, raw, async (a) => {
          ports.api.vaults.rename(String(a.id), String(a.name));
          return null;
        }),
    },
    {
      name: "vault_delete",
      description:
        "Delete a vault. Refused while it still holds anything, unless cascade is true — which "
        + "deletes everything filed in it as well, and cannot be undone. The personal vault and "
        + "team vaults are always refused.",
      risk: "prompt",
      schema: z.object({ id: z.string(), cascade: z.boolean().optional() }),
      execute: async (raw) =>
        op("vault_delete", "agent.object_deleted", { objectType: "vault", objectId: String(raw.id) }, raw, (a) =>
          ports.api.vaults.delete(String(a.id), { cascade: a.cascade === true })),
    },
  ];
}
