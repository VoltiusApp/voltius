import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";

export const HISTORY_PERMISSIONS = ["history:read"] as const;

export function buildHistoryTools(ports: ToolSurfacePorts): Tool[] {
  return [
    {
      name: "history_search",
      description:
        "Search the commands the user typed in terminals, newest first. Useful for recovering the "
        + "exact invocation someone ran on a host. Defaults to 50 results, capped at 200.",
      risk: "auto",
      schema: z.object({
        query: z.string().optional(),
        connection_id: z.string().optional(),
        session_id: z.string().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (raw) => {
        const a = raw as { query?: string; connection_id?: string; session_id?: string; limit?: number };
        return ports.api.history.search({
          query: a.query,
          connectionId: a.connection_id,
          sessionId: a.session_id,
          limit: a.limit,
        });
      },
    },
  ];
}
