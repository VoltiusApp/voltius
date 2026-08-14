import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";

export const AUDIT_PERMISSIONS = ["audit:read"] as const;

export function buildAuditTools(ports: ToolSurfacePorts): Tool[] {
  return [
    {
      name: "audit_query",
      description:
        "Read activity, newest first. Without team_id this reads the device's own log; with "
        + "team_id it reads that team's server-side log, which is what the app's own Logs tab "
        + "shows and is bounded by your role on that team.",
      risk: "auto",
      schema: z.object({
        action: z.string().optional(),
        team_id: z.string().optional(),
        vault_id: z.string().optional(),
        actor_id: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: async (raw) =>
        ports.api.audit.query({
          actions: raw.action ? [String(raw.action)] : undefined,
          teamId: raw.team_id as string | undefined,
          vaultId: raw.vault_id as string | undefined,
          actorId: raw.actor_id as string | undefined,
          from: raw.from as string | undefined,
          to: raw.to as string | undefined,
          page: (raw.page as number | undefined) ?? 1,
          perPage: (raw.limit as number | undefined) ?? 50,
        }),
    },
  ];
}
