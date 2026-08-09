import { describe, it, expect, vi } from "vitest";
import { buildMonitoringMcpTools } from "./mcpTools";
import type { PluginAPI } from "@/plugins/api";

const api = () => {
  const stop = vi.fn(async () => undefined);
  return {
    api: {
      sessions: { list: () => [{ id: "s1", type: "ssh", status: "connected", connectionId: "c1", connectionName: "h" }] },
      metrics: {
        start: vi.fn(async () => "st1"),
        stop,
        onSnapshot: vi.fn(async (_id: string, cb: (s: unknown) => void) => {
          setTimeout(() => cb({ cpu: 12 }), 0);
          return () => {};
        }),
      },
    } as unknown as PluginAPI,
    stop,
  };
};

describe("the monitoring MCP tools", () => {
  it("returns the first snapshot and stops the stream", async () => {
    const { api: a, stop } = api();
    const tool = buildMonitoringMcpTools(a)[0];
    expect(tool.name).toBe("metrics_snapshot");
    expect(tool.mutating).toBe(false);
    await expect(tool.execute({ sessionId: "s1" })).resolves.toEqual({ cpu: 12 });
    expect(stop).toHaveBeenCalledWith("st1");
  });
});
