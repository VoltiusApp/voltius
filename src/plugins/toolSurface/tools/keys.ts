import { z } from "zod";
import type { PluginAuditAction } from "@/plugins/api";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { makeGate } from "./helpers";

export const KEY_PERMISSIONS = ["keys:read", "keys:write", "audit"] as const;

/**
 * Approve, record, then run a mutating object operation. Unlike fileOp this
 * writes NO localMetadata: object args carry secrets (private keys, passwords)
 * and the local sink is not a place to put them.
 */
export function objectOp(ports: ToolSurfacePorts, gate: ReturnType<typeof makeGate>) {
  return async (
    tool: string,
    action: PluginAuditAction,
    meta: Record<string, unknown>,
    raw: Record<string, unknown>,
    run: (args: Record<string, unknown>) => Promise<unknown>,
  ): Promise<unknown> => {
    const g = await gate(tool, raw);
    if (!g.ok) return g.result;
    ports.audit(g.scope, action, { tool, approval: g.via, ...meta }, undefined);
    try {
      return { ok: true, result: (await run(g.args)) ?? null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
}

export function buildKeyTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);
  return [
    {
      name: "key_list",
      description:
        "List the SSH keys saved in the vault (id, name, type, tags). Private key material is never "
        + "returned.",
      risk: "auto",
      schema: z.object({}),
      execute: async () => ports.api.keys.list(),
    },
    {
      name: "key_create",
      description:
        "Save an SSH key pair in the vault. `privateKey` is the full PEM/OpenSSH text. Returns the "
        + "new key's id.",
      risk: "prompt",
      schema: z.object({
        name: z.string().optional(),
        keyType: z.string().optional(),
        tags: z.array(z.string()).optional(),
        privateKey: z.string(),
        publicKey: z.string().optional(),
      }),
      execute: async (raw) =>
        op("key_create", "agent.object_created", { objectType: "key" }, raw, (a) =>
          ports.api.keys.create(
            {
              name: a.name as string | undefined,
              key_type: a.keyType as string | undefined,
              tags: (a.tags as string[] | undefined) ?? [],
            },
            String(a.privateKey),
            a.publicKey as string | undefined,
          )),
    },
    {
      name: "key_delete",
      description:
        "Delete a saved SSH key by id. Cannot be undone, and any connection using it will stop "
        + "authenticating.",
      risk: "prompt",
      schema: z.object({ id: z.string() }),
      execute: async (raw) =>
        op("key_delete", "agent.object_deleted", { objectType: "key", objectId: String(raw.id) }, raw, (a) =>
          ports.api.keys.delete(String(a.id))),
    },
  ];
}
