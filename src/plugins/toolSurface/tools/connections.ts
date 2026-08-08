import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";

export const CONNECTION_PERMISSIONS = ["connections:read", "audit"] as const;

export function buildConnectionTools(ports: ToolSurfacePorts): Tool[] {
  return [
    {
      name: "list_connections",
      description:
        "List the user's saved SSH/host connections (id, name, host). `team: true` marks one "
        + "shared through a team vault; it is addressable exactly like a personal connection.",
      risk: "auto",
      schema: z.object({}),
      execute: async () => {
        const conns = await ports.api.connections.list();
        return conns.map((c) => ({
          id: c.id, name: c.name, host: c.host, ...(c.team ? { team: true } : {}),
        }));
      },
    },
  ];
}
