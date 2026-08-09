import { describe, it, expect, vi } from "vitest";
import { buildProxmoxMcpTools } from "./mcpTools";
import type { PluginAPI } from "@/plugins/api";

const api = () =>
  ({
    sessions: {
      list: () => [
        { id: "s1", type: "ssh", status: "connected", connectionId: "c1", connectionName: "pve" },
        { id: "s2", type: "local", status: "connected", connectionId: "", connectionName: "local" },
      ],
    },
    proxmox: {
      lxc: {
        list: vi.fn(async () => [{ vmid: 100 }]),
        action: vi.fn(async () => undefined),
        snapshots: {
          list: vi.fn(async () => []),
          create: vi.fn(async () => undefined),
          rollback: vi.fn(async () => undefined),
        },
      },
    },
  }) as unknown as PluginAPI;

describe("the proxmox MCP tools", () => {
  it("contributes exactly the five curated verbs", () => {
    expect(buildProxmoxMcpTools(api()).map((t) => t.name)).toEqual([
      "lxc_list", "lxc_action", "snapshot_list", "snapshot_create", "snapshot_rollback",
    ]);
  });

  it("refuses a non-SSH session rather than issuing a pct command locally", async () => {
    await expect(
      buildProxmoxMcpTools(api()).find((t) => t.name === "lxc_list")!.execute({ sessionId: "s2" }),
    ).rejects.toThrow(/SSH/);
  });

  it("passes vmid through as a number", async () => {
    const a = api();
    await buildProxmoxMcpTools(a).find((t) => t.name === "lxc_action")!
      .execute({ sessionId: "s1", vmid: 100, action: "start" });
    expect(a.proxmox.lxc.action).toHaveBeenCalledWith("s1", 100, "start");
  });

  it("marks rollback mutating and the list verbs non-mutating", () => {
    const tools = buildProxmoxMcpTools(api());
    expect(tools.find((t) => t.name === "snapshot_rollback")!.mutating).toBe(true);
    expect(tools.find((t) => t.name === "snapshot_list")!.mutating).toBe(false);
  });
});
