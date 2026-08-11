import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import type { PluginFolderKind } from "@/plugins/api";
import { makeGate, objectOp } from "./helpers";

export const FOLDER_PERMISSIONS = ["folders:read", "folders:write", "audit"] as const;

const kind = z.enum(["connection", "keychain", "port_forwarding", "snippet"]);

export function buildFolderTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);
  return [
    {
      name: "folder_list",
      description:
        "List folders. One keychain tree holds both keys and identities. Omit kind for every "
        + "folder across all four trees.",
      risk: "auto",
      schema: z.object({ kind: kind.optional() }),
      execute: async (raw) =>
        ports.api.folders.list(raw.kind as PluginFolderKind | undefined),
    },
    {
      name: "folder_create",
      description:
        "Create a folder of one kind: connection, keychain (keys and identities), port_forwarding "
        + "or snippet. Defaults to the personal vault. Team vaults are refused.",
      risk: "prompt",
      schema: z.object({
        kind,
        name: z.string(),
        vaultId: z.string().optional(),
        parentFolderId: z.string().optional(),
      }),
      execute: async (raw) =>
        op("folder_create", "agent.object_created", { objectType: "folder" }, raw, (a) =>
          ports.api.folders.create({
            kind: a.kind as PluginFolderKind,
            name: String(a.name),
            vaultId: a.vaultId as string | undefined,
            parentFolderId: a.parentFolderId as string | undefined,
          })),
    },
    {
      name: "folder_rename",
      description: "Rename a folder. Its kind, vault and parent are unchanged. Team vaults are refused.",
      risk: "prompt",
      schema: z.object({ id: z.string(), name: z.string() }),
      execute: async (raw) =>
        op("folder_rename", "agent.object_updated", { objectType: "folder", objectId: String(raw.id) }, raw, (a) =>
          ports.api.folders.rename(String(a.id), String(a.name))),
    },
    {
      name: "folder_delete",
      description:
        "Delete a folder and, by default, everything filed in it including its subfolders. Pass "
        + "cascade false to delete only the folder — not available for snippet folders. Cannot be "
        + "undone. Team vaults are refused.",
      risk: "prompt",
      schema: z.object({ id: z.string(), cascade: z.boolean().optional() }),
      execute: async (raw) =>
        op("folder_delete", "agent.object_deleted", { objectType: "folder", objectId: String(raw.id) }, raw, (a) =>
          ports.api.folders.delete(String(a.id), { cascade: a.cascade !== false })),
    },
  ];
}
