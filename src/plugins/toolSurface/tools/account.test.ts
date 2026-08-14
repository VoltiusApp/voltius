import { describe, expect, test, vi } from "vitest";
import { buildAccountTools } from "./account";
import type { ToolSurfacePorts } from "../coreTools";

describe("subscription_status", () => {
  test("rend la vue du domaine, en lecture auto", async () => {
    const view = { tier: "pro", usedSeats: 2, totalSeats: 5, stale: false };
    const ports = {
      api: { account: { subscription: vi.fn(async () => view) } },
      approve: async () => ({ approve: true as const, scope: "mcp", via: "granted" as const }),
      audit: vi.fn(),
      owned: new Set<string>(),
    } as unknown as ToolSurfacePorts;

    const tool = buildAccountTools(ports)[0];
    expect(tool.name).toBe("subscription_status");
    expect(tool.risk).toBe("auto");
    expect(await tool.execute({})).toEqual(view);
  });
});
