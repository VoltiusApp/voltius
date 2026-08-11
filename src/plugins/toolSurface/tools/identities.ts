import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { makeGate, objectOp } from "./helpers";
import { placement } from "../placement";

export const IDENTITY_PERMISSIONS = ["identities:read", "identities:write", "audit"] as const;

/** Project a raw Identity record down to the PluginIdentity contract. */
const toPluginIdentity = (i: Record<string, unknown>) => ({
  id: i.id, name: i.name, username: i.username, key_id: i.key_id, tags: i.tags,
  ...placement(i),
});

export function buildIdentityTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);
  return [
    {
      name: "identity_list",
      description:
        "List the saved identities (a username plus an optional key) that connections authenticate "
        + "with, and the vault and folder each is filed in.",
      risk: "auto",
      schema: z.object({}),
      execute: async () => {
        const identities = await ports.api.identities.list();
        return identities.map((i) => toPluginIdentity(i as unknown as Record<string, unknown>));
      },
    },
    {
      name: "identity_create",
      description:
        "Create an identity: a username, and optionally the id of a key from key_list to "
        + "authenticate with. Returns the new identity's id.",
      risk: "prompt",
      schema: z.object({
        name: z.string().optional(),
        username: z.string(),
        keyId: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
      execute: async (raw) =>
        op("identity_create", "agent.object_created", { objectType: "identity" }, raw, async (a) =>
          toPluginIdentity(
            (await ports.api.identities.create({
              name: a.name as string | undefined,
              username: String(a.username),
              key_id: a.keyId as string | undefined,
              tags: (a.tags as string[] | undefined) ?? [],
            })) as unknown as Record<string, unknown>,
          )),
    },
    {
      name: "identity_delete",
      description:
        "Delete a saved identity by id. Connections referencing it will fall back to their own "
        + "username.",
      risk: "prompt",
      schema: z.object({ id: z.string() }),
      execute: async (raw) =>
        op("identity_delete", "agent.object_deleted", { objectType: "identity", objectId: String(raw.id) }, raw, (a) =>
          ports.api.identities.delete(String(a.id))),
    },
  ];
}
