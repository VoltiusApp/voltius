import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";

export const TELEMETRY_PERMISSIONS = ["sync:read", "health:read"] as const;

export function buildTelemetryTools(ports: ToolSurfacePorts): Tool[] {
  return [
    {
      name: "sync_status",
      description:
        "The state of the user's own configuration sync: whether it is idle, running, succeeded, "
        + "failed or offline, when it last succeeded, the last error, and the size of the synced "
        + "blob. Says nothing about team vaults.",
      risk: "auto",
      schema: z.object({}),
      execute: async () => ports.api.appSync.status(),
    },
    {
      name: "host_ping_status",
      description:
        "Reachability of the user's saved hosts as the app last observed it, with latency where "
        + "known. These are cached results from the app's own polling — calling this does not "
        + "probe anything, so it will not tell you whether a host is reachable *now*, and polling "
        + "it in a loop achieves nothing. A host the app has not polled reports \"unknown\".",
      risk: "auto",
      schema: z.object({}),
      execute: async () => ports.api.health.pingStatus(),
    },
  ];
}
