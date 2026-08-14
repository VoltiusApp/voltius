import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { refusal } from "../refusal";
import { makeGate, objectOp, unwrapDomain } from "./helpers";
import { EXPORT_TYPES, type ExportType } from "@/plugins/domains/importexport";

export const IMPORT_EXPORT_PERMISSIONS = ["importexport:read", "importexport:write", "fs"] as const;

export function buildImportExportTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);

  return [
    {
      name: "export_objects",
      description:
        "Export saved objects — connections, identities, SSH keys, snippets, port-forwarding rules "
        + "— from one or more vaults. If the selection carries any secret (a password, a private "
        + "key, a passphrase, a connection note), the call is refused unless you pass a passphrase, "
        + "and the result is then encrypted with it: you get ciphertext, not the secrets. With "
        + "`path`, the bundle is written to that file and only the path and per-type counts come "
        + "back; without it, the bundle is returned inline.",
      risk: "auto",
      schema: z.object({
        vault_ids: z.array(z.string()).optional(),
        types: z.array(z.enum(EXPORT_TYPES)).optional(),
        format: z.enum(["json", "csv"]).optional(),
        passphrase: z.string().optional(),
        path: z.string().optional(),
      }),
      execute: async (raw) => {
        const result = await ports.api.importExport.export({
          vaultIds: (raw.vault_ids as string[] | undefined) ?? ["personal"],
          types: (raw.types as ExportType[] | undefined) ?? [...EXPORT_TYPES],
          format: (raw.format as "json" | "csv" | undefined) ?? "json",
          passphrase: raw.passphrase as string | undefined,
        });
        if (!result.ok) return refusal(result.error);
        const { content, encrypted, counts } = result.result;
        const path = raw.path as string | undefined;
        if (!path) return { content, encrypted, counts };
        await ports.api.fs.writeText(path, content ?? "");
        // The content is deliberately withheld once it is on disk: putting it in
        // the response too would defeat the point of asking for a path.
        return { path, encrypted, counts };
      },
    },
    {
      name: "import_objects",
      description:
        "Import a bundle produced by export_objects, or a Termius, MobaXterm or CSV export, into "
        + "one vault. Give it `content` or a `path`. An encrypted bundle needs the passphrase it "
        + "was exported with. Importing only ever adds: existing items are matched and skipped, "
        + "never overwritten. With dry_run: true, nothing is written and you get the per-type "
        + "counts the bundle contains.",
      risk: "prompt",
      schema: z.object({
        content: z.string().optional(),
        path: z.string().optional(),
        vault_id: z.string().optional(),
        passphrase: z.string().optional(),
        dry_run: z.boolean().optional(),
      }),
      execute: async (raw) => {
        // Doomed before the gate: nothing to import raises no approval card.
        if (raw.content === undefined && raw.path === undefined) {
          return refusal("import_objects needs either content or path");
        }
        return op("import_objects", "agent.objects_imported", (a) => ({
          vault_id: String(a.vault_id ?? "personal"),
          dry_run: a.dry_run === true,
          // Bundle contents are the user's own data; only the shape of the call
          // goes on a row that can leave the device.
          source: a.path ? "path" : "inline",
        }), raw, async (a) => {
          const content = a.content !== undefined
            ? String(a.content)
            : await ports.api.fs.readText(String(a.path));
          return unwrapDomain(await ports.api.importExport.import({
            content,
            vaultId: String(a.vault_id ?? "personal"),
            passphrase: a.passphrase as string | undefined,
            dryRun: a.dry_run === true,
          }));
        });
      },
    },
  ];
}
