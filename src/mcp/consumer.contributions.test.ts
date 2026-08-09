import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildMcpTools, callTool } from "./consumer";
import { registerContributions, clearContributions } from "./contributions";
import { setPluginExposed, useMcpContributionStore } from "@/stores/mcpContributionStore";
import type { PluginAPI } from "@/plugins/api";

const record = vi.fn();
const stubApi = () =>
  ({
    sessions: { list: () => [] },
    audit: { record, query: async () => ({ logs: [], total: 0 }) },
    connections: { list: async () => [] },
  }) as unknown as PluginAPI;

const TOOL = {
  name: "restart",
  description: "Restart something.",
  inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
  execute: vi.fn(async () => "done"),
};

describe("contributed tools in the MCP tool list", () => {
  beforeEach(() => {
    record.mockReset();
    TOOL.execute.mockClear();
    clearContributions("plugin-docker");
    useMcpContributionStore.setState({ exposed: {} });
  });

  it("appears in the built list under its namespace", () => {
    registerContributions("plugin-docker", [TOOL]);
    const names = buildMcpTools(stubApi(), new Set()).map((t) => t.name);
    expect(names).toContain("docker__restart");
    expect(names).toContain("list_sessions");
  });

  it("is omitted when the plugin's row is toggled off", () => {
    registerContributions("plugin-docker", [TOOL]);
    setPluginExposed("plugin-docker", false);
    expect(buildMcpTools(stubApi(), new Set()).map((t) => t.name)).not.toContain("docker__restart");
  });

  it("writes one agent.plugin_tool_run row per mutating call, with no arguments in it", async () => {
    registerContributions("plugin-docker", [TOOL]);
    const tools = buildMcpTools(stubApi(), new Set());
    const res = await callTool(tools, "docker__restart", { sessionId: "s1" });
    expect(res).toEqual({ ok: true, result: "done" });
    expect(record).toHaveBeenCalledTimes(1);
    const [scope, action, metadata, localMetadata] = record.mock.calls[0];
    expect(scope).toBe("s1");
    expect(action).toBe("agent.plugin_tool_run");
    expect(metadata).toEqual({ via: "mcp", pluginId: "plugin-docker", tool: "docker__restart" });
    // No localMetadata, and no argument values anywhere: a contributed verb's
    // arguments can carry anything its schema allows.
    expect(localMetadata).toBeUndefined();
  });

  it("writes no row for a tool declared non-mutating", async () => {
    registerContributions("plugin-docker", [{ ...TOOL, name: "list", mutating: false }]);
    const tools = buildMcpTools(stubApi(), new Set());
    await callTool(tools, "docker__list", { sessionId: "s1" });
    expect(record).not.toHaveBeenCalled();
  });

  it("rejects arguments that fail the contributed schema before executing", async () => {
    registerContributions("plugin-docker", [TOOL]);
    const tools = buildMcpTools(stubApi(), new Set());
    const res = await callTool(tools, "docker__restart", {});
    expect(res).toMatchObject({ ok: false });
    expect(TOOL.execute).not.toHaveBeenCalled();
  });
});
