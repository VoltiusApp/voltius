import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHostPluginAPI, loadPlugin, unloadPlugin, setPluginActive } from "./runtime";
import { listContributions, clearContributions } from "@/mcp/contributions";
import type { PluginManifest, PluginRegisterFn } from "./api";

const TOOL = {
  name: "ping",
  description: "Ping.",
  inputSchema: { type: "object", properties: {} },
  execute: async () => "pong",
};

function manifest(id: string, permissions: string[]): PluginManifest {
  return { id, name: id, version: "1.0.0", permissions };
}

describe("api.mcp", () => {
  beforeEach(() => {
    clearContributions("test:mcp");
    clearContributions("t-life");
  });

  afterEach(() => {
    try {
      unloadPlugin("t-life");
    } catch {
      /* noop */
    }
  });

  it("throws when the plugin did not declare mcp:contribute", () => {
    const api = createHostPluginAPI("test:mcp", ["storage"]);
    expect(() => api.mcp.registerTools([TOOL])).toThrow(/mcp:contribute/);
  });

  it("registers the set when the permission is declared", () => {
    const api = createHostPluginAPI("test:mcp", ["mcp:contribute"]);
    api.mcp.registerTools([TOOL]);
    expect(listContributions().map((t) => t.name)).toContain("test:mcp__ping");
  });

  it("unloadPlugin removes the contributions even if the plugin's cleanup did not", () => {
    const register: PluginRegisterFn = (api) => {
      api.mcp.registerTools([TOOL]);
    };
    loadPlugin(manifest("t-life", ["mcp:contribute"]), register, true, false);
    expect(listContributions().some((t) => t.pluginId === "t-life")).toBe(true);
    unloadPlugin("t-life");
    expect(listContributions().some((t) => t.pluginId === "t-life")).toBe(false);
  });

  it("disabling a plugin removes its contributions, re-enabling restores them", () => {
    const register: PluginRegisterFn = (api) => {
      api.mcp.registerTools([TOOL]);
    };
    loadPlugin(manifest("t-life", ["mcp:contribute"]), register, true, false);
    setPluginActive("t-life", false);
    expect(listContributions().some((t) => t.pluginId === "t-life")).toBe(false);
    setPluginActive("t-life", true);
    expect(listContributions().some((t) => t.pluginId === "t-life")).toBe(true);
    unloadPlugin("t-life");
  });

  it("a register() that throws after contributing leaves nothing registered", () => {
    const register: PluginRegisterFn = (api) => {
      api.mcp.registerTools([TOOL]);
      throw new Error("boom");
    };
    expect(() => loadPlugin(manifest("t-life", ["mcp:contribute"]), register, true, false)).toThrow(/boom/);
    expect(listContributions().some((t) => t.pluginId === "t-life")).toBe(false);
  });
});
