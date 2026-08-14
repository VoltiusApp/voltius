import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { refusal } from "../refusal";

// "team:read" because the team branch reads a whole team's server-side log —
// every member's activity, which is what that permission gates elsewhere.
export const AUDIT_PERMISSIONS = ["audit:read", "team:read"] as const;

export function buildAuditTools(ports: ToolSurfacePorts): Tool[] {
  return [
    {
      name: "audit_query",
      description:
        "Read activity, newest first. Without team_id this reads the device's own log; with "
        + "team_id it reads that team's server-side log, which is what the app's own Logs tab "
        + "shows and is bounded by your role on that team. vault_id without team_id selects "
        + "which local vault's log to read, it does not reach the server.",
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
      execute: async (raw) => {
        try {
          return await ports.api.audit.query({
            actions: raw.action ? [String(raw.action)] : undefined,
            teamId: raw.team_id as string | undefined,
            vaultId: raw.vault_id as string | undefined,
            actorId: raw.actor_id as string | undefined,
            from: raw.from as string | undefined,
            to: raw.to as string | undefined,
            page: (raw.page as number | undefined) ?? 1,
            perPage: (raw.limit as number | undefined) ?? 50,
          });
        } catch (err) {
          // The team branch is a network call that throws on a non-2xx or an
          // offline device; a raw Error tells the model nothing to act on.
          const detail = err instanceof Error ? err.message : String(err);
          return refusal(
            raw.team_id
              ? `Could not read team "${String(raw.team_id)}" activity from the server (${detail}). `
                + "The device may be offline, signed out, or without access to that team; "
                + "omit team_id to read this device's own log instead."
              : `Could not read this device's activity log (${detail}).`,
          );
        }
      },
    },
  ];
}
