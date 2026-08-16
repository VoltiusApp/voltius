import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";

export const ACCOUNT_PERMISSIONS = ["account:read"] as const;

export function buildAccountTools(ports: ToolSurfacePorts): Tool[] {
  return [
    {
      name: "subscription_status",
      description:
        "Read the signed-in account's plan: tier, trial state, seats in use, billing status and "
        + "renewal dates. Refreshes from the server first; `stale` is true when that refresh failed.",
      risk: "auto",
      schema: z.object({}),
      execute: async () => ports.api.account.subscription(),
    },
  ];
}
