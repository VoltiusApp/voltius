import { describe, test, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
const loadPlugin = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("./runtime", () => ({ loadPlugin: (...a: unknown[]) => loadPlugin(...a) }));
vi.mock("@/stores/pluginRegistryStore", () => ({
  usePluginRegistryStore: { getState: () => ({ isEnabled: () => true }) },
}));

import { loadSeededPlugins } from "./seeded";

describe("loadSeededPlugins", () => {
  beforeEach(() => {
    invoke.mockReset();
    loadPlugin.mockReset();
  });

  test("returns without throwing when there are no seeded plugins", async () => {
    invoke.mockResolvedValueOnce([]);
    await loadSeededPlugins();
    expect(loadPlugin).not.toHaveBeenCalled();
  });

  test("one plugin failing to load does not prevent the others", async () => {
    invoke.mockImplementation(async (cmd: string, args: Record<string, string>) => {
      if (cmd === "plugins_list_seeded") return ["broken", "ok"];
      if (cmd === "plugin_seeded_read") {
        if (args.id === "broken") throw new Error("missing");
        return JSON.stringify({ id: "ok", version: "1.0.0", permissions: [] });
      }
      return "";
    });
    await loadSeededPlugins();
    // "broken" throws on its manifest read; "ok" must still be reached.
    expect(invoke).toHaveBeenCalledWith("plugin_seeded_read", { id: "ok", filename: "index.js" });
  });

  test("a plugin whose manifest is unreadable does not abort the loop", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "plugins_list_seeded") return ["a", "b"];
      throw new Error("boom");
    });
    await expect(loadSeededPlugins()).resolves.toBeUndefined();
    expect(loadPlugin).not.toHaveBeenCalled();
  });
});
