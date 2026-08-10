import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { makeGate, objectOp } from "./helpers";

export const KEY_PERMISSIONS = ["keys:read", "keys:write", "connections:read", "audit"] as const;

/** No quote/semicolon/dollar/backtick (shell metacharacters) and no ".." (path
 *  escape) — key_add_to_host's location/filename land inside a shell command. */
const SAFE_PATH_SEGMENT = /^(?!.*\.\.)[^'";$`]+$/;

/** Project a raw Key record down to the PluginKey contract. */
const toPluginKey = (k: Record<string, unknown>) => ({
  id: k.id, name: k.name, key_type: k.key_type, tags: k.tags,
});

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
      execute: async () => {
        const keys = await ports.api.keys.list();
        return keys.map((k) => toPluginKey(k as unknown as Record<string, unknown>));
      },
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
        op("key_create", "agent.object_created", { objectType: "key" }, raw, async (a) =>
          toPluginKey(
            (await ports.api.keys.create(
              {
                name: a.name as string | undefined,
                key_type: a.keyType as string | undefined,
                tags: (a.tags as string[] | undefined) ?? [],
              },
              String(a.privateKey),
              a.publicKey as string | undefined,
            )) as unknown as Record<string, unknown>,
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
    {
      name: "key_add_to_host",
      description:
        "Append an SSH key's public half to a host's authorized_keys over SSH, using the "
        + "connection's stored credentials. This writes to the remote machine.",
      risk: "prompt",
      schema: z.object({
        key_id: z.string(),
        connection_id: z.string(),
        location: z.string().regex(SAFE_PATH_SEGMENT).optional(),
        filename: z.string().regex(SAFE_PATH_SEGMENT).optional(),
      }),
      execute: async (raw) =>
        op(
          "key_add_to_host",
          "agent.object_updated",
          { objectType: "key", objectId: String(raw.key_id), connectionId: String(raw.connection_id) },
          raw,
          async (a) => {
            await ports.api.keys.addToHost({
              keyId: String(a.key_id),
              connectionId: String(a.connection_id),
              location: a.location ? String(a.location) : ".ssh",
              filename: a.filename ? String(a.filename) : "authorized_keys",
            });
            return null;
          },
        ),
    },
  ];
}
