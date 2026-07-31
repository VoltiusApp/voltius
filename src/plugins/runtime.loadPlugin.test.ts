import { describe, test, expect, afterEach } from "vitest";
import { loadPlugin, unloadPlugin, getLoadedPlugins } from "./runtime";
import { usePluginStore } from "@/stores/pluginStore";
import type { PluginManifest, PluginRegisterFn, MobileScreen } from "./api";

function manifest(perms: string[]): PluginManifest {
  return { id: "t", name: "T", version: "1", permissions: perms };
}

const screen: MobileScreen = {
  id: "metrics",
  kind: "metrics",
  title: "Metrics",
  render: () => null,
};

afterEach(() => {
  try {
    unloadPlugin("t");
  } catch {
    /* noop */
  }
});

describe("loadPlugin: a throwing register()", () => {
  test("leaves no registry entry and rethrows", () => {
    const register: PluginRegisterFn = () => {
      throw new Error("boom");
    };
    expect(() => loadPlugin(manifest([]), register, true, false)).toThrow(/boom/);
    expect(getLoadedPlugins().some((m) => m.id === "t")).toBe(false);
  });

  test("rolls back contributions registered before the throw", () => {
    const register: PluginRegisterFn = (api) => {
      api.ui.registerMobileScreen(screen);
      throw new Error("boom");
    };
    expect(() => loadPlugin(manifest(["right-panel"]), register, true, false)).toThrow(/boom/);
    expect(usePluginStore.getState().mobileScreens.has("t:metrics")).toBe(false);
  });

  test("a subsequent load of the same plugin id is not blocked as 'already loaded'", () => {
    const throwing: PluginRegisterFn = () => {
      throw new Error("boom");
    };
    expect(() => loadPlugin(manifest([]), throwing, true, false)).toThrow(/boom/);
    const ok: PluginRegisterFn = () => undefined;
    expect(() => loadPlugin(manifest([]), ok, true, false)).not.toThrow();
    expect(getLoadedPlugins().some((m) => m.id === "t")).toBe(true);
  });
});
