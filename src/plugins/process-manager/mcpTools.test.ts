import { describe, it, expect, vi } from "vitest";
import { buildProcessMcpTools } from "./mcpTools";
import type { PluginAPI } from "@/plugins/api";

const api = () => {
  const kill = vi.fn(async () => undefined);
  return {
    api: {
      sessions: { list: () => [{ id: "s1", type: "ssh", status: "connected", connectionId: "c1", connectionName: "h" }] },
      processes: {
        start: vi.fn(async () => "st1"),
        stop: vi.fn(async () => undefined),
        onSnapshot: vi.fn(async (_id: string, cb: (s: unknown) => void) => {
          setTimeout(() => cb([{ pid: 42 }]), 0);
          return () => {};
        }),
        kill,
      },
    } as unknown as PluginAPI,
    kill,
  };
};

describe("the process-manager MCP tools", () => {
  it("contributes a non-mutating list and a mutating kill", () => {
    const tools = buildProcessMcpTools(api().api);
    expect(tools.map((t) => t.name)).toEqual(["process_list", "process_kill"]);
    expect(tools[0].mutating).toBe(false);
    expect(tools[1].mutating).toBe(true);
  });

  it("returns the first process snapshot", async () => {
    const { api: a } = api();
    await expect(buildProcessMcpTools(a)[0].execute({ sessionId: "s1" })).resolves.toEqual([{ pid: 42 }]);
  });

  it("passes isRemote and force through to kill", async () => {
    const { api: a, kill } = api();
    await buildProcessMcpTools(a)[1].execute({ sessionId: "s1", pid: 42, force: true });
    expect(kill).toHaveBeenCalledWith("s1", 42, true, true);
  });
});
