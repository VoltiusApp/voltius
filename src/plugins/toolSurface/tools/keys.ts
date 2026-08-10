import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { makeGate, objectOp } from "./helpers";

export const KEY_PERMISSIONS = ["keys:read", "keys:write", "connections:read", "audit"] as const;

/** No quote/semicolon/dollar/backtick (shell metacharacters) and no whitespace
 *  (including newline) — key_add_to_host's location/filename land inside a
 *  shell command. "." and ".." are refused as whole segments so the path cannot
 *  escape, nor resolve to the remote home itself. */
const UNSAFE_SEGMENT_CHAR = /[\s'";$`]/;

const isSafeSegment = (segment: string): boolean =>
  segment.length > 0 && segment !== "." && segment !== ".." && !UNSAFE_SEGMENT_CHAR.test(segment);

/** A directory RELATIVE to the remote home: a leading "/" would make it absolute,
 *  which is what turns this verb into an arbitrary-file write (/etc/cron.d). */
const relativeDir = z.string().refine(
  (v) => !v.startsWith("/") && v.split("/").every(isSafeSegment),
  "must be a relative path under the remote home",
);

/** A bare filename: "/" is refused outright, so no directory can be reached through it. */
const safeFilename = z.string().refine(
  (v) => !v.includes("/") && isSafeSegment(v),
  "must be a filename with no path separator",
);

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
        location: relativeDir.optional(),
        filename: safeFilename.optional(),
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
