import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";

export const AUDIT_PERMISSIONS = ["audit:read"] as const;

export function buildAuditTools(ports: ToolSurfacePorts): Tool[] {
  return [
    {
      name: "audit_query",
      description:
        "Read this device's activity log, newest first. Records only what happened on this "
        + "machine; team-vault activity is not returned.",
      risk: "auto",
      schema: z.object({
        action: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: async (raw) =>
        ports.api.audit.query({
          actions: raw.action ? [String(raw.action)] : undefined,
          from: raw.from as string | undefined,
          to: raw.to as string | undefined,
          page: (raw.page as number | undefined) ?? 1,
          perPage: (raw.limit as number | undefined) ?? 50,
        }),
    },
  ];
}
