import { describe, test, expect, afterEach } from "vitest";
import { loadPlugin, unloadPlugin, getLoadedPlugins } from "./runtime";
import { usePluginStore } from "@/stores/pluginStore";
import type { PluginManifest, PluginRegisterFn } from "./api";

const register: PluginRegisterFn = (api) =>
  api.ui.registerRightPanelSection({
    id: "panel", label: "P", icon: "lucide:box", component: () => null,
  });

function manifest(id: string): PluginManifest {
  return { id, name: "x", version: "1", permissions: ["right-panel"] };
}

afterEach(() => {
  for (const m of getLoadedPlugins()) {
    try { unloadPlugin(m.id); } catch { /* noop */ }
  }
});

describe("loadPlugin rejects a malformed plugin id", () => {
  test.each(["../evil", "a/b", "a\\b", "foo:x", "__meta__", "Foo", ""])(
    "rejects %j and registers nothing",
    (id) => {
      expect(() => loadPlugin(manifest(id), register, true, false)).toThrow(/Invalid plugin id/);
      expect(getLoadedPlugins().some((m) => m.id === id)).toBe(false);
      expect(usePluginStore.getState().rightPanelSections.size).toBe(0);
    },
  );

  test("still loads a valid id", () => {
    expect(() => loadPlugin(manifest("plugin-docker"), register, true, false)).not.toThrow();
    expect(getLoadedPlugins().some((m) => m.id === "plugin-docker")).toBe(true);
  });
});
