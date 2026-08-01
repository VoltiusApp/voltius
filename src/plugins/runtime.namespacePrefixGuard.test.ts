import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { loadPlugin, unloadPlugin } from "./runtime";
import { usePluginStore } from "@/stores/pluginStore";
import type { PluginManifest, PluginRegisterFn } from "./api";

// All four `register*` functions in runtime.ts prefix a contributed id with
// `${pluginId}:` so it can't collide with another plugin's, and so unregisterAll's
// `${pluginId}:` filter can find it on every teardown path. Each guard must be
// `id.startsWith(\`${id}:\`)`, not `id.startsWith(id)` — the latter is satisfied
// by any contributed id that merely starts with the plugin id's characters (no
// colon required), which leaves the key un-namespaced whenever a plugin id is a
// prefix of its own contributed id, e.g. plugin "monitor" + section "monitoring".

function manifest(id: string, perms: string[]): PluginManifest {
  return { id, name: id, version: "1", permissions: perms };
}

afterEach(() => {
  for (const id of ["monitor"]) {
    try { unloadPlugin(id); } catch { /* noop */ }
  }
});

describe("prefix guard requires a colon (plugin id 'monitor', contributed id 'monitoring')", () => {
  beforeEach(() => usePluginStore.setState({
    settingsPages: new Map(), globalPanels: new Map(), mobileScreens: new Map(),
  }));

  test("registerSettingsPage namespaces the id and unloadPlugin removes it", () => {
    const register: PluginRegisterFn = (api) =>
      api.ui.registerSettingsPage({ id: "monitoring", label: "Monitoring", icon: "x", component: () => null });
    loadPlugin(manifest("monitor", ["settings-page"]), register, true, false);

    const pages = usePluginStore.getState().settingsPages;
    expect(pages.has("monitor:monitoring")).toBe(true);
    expect(pages.has("monitoring")).toBe(false);

    unloadPlugin("monitor");
    expect(usePluginStore.getState().settingsPages.size).toBe(0);
  });

  test("registerGlobalPanel namespaces the id and unloadPlugin removes it", () => {
    const register: PluginRegisterFn = (api) =>
      api.ui.registerGlobalPanel({ id: "monitoring", component: () => null });
    loadPlugin(manifest("monitor", ["global-panel"]), register, true, false);

    const panels = usePluginStore.getState().globalPanels;
    expect(panels.has("monitor:monitoring")).toBe(true);
    expect(panels.has("monitoring")).toBe(false);

    unloadPlugin("monitor");
    expect(usePluginStore.getState().globalPanels.size).toBe(0);
  });

  test("registerMobileScreen namespaces the id and unloadPlugin removes it", () => {
    const register: PluginRegisterFn = (api) =>
      api.ui.registerMobileScreen({ id: "monitoring", kind: "metrics", render: () => null });
    loadPlugin(manifest("monitor", ["right-panel"]), register, true, false);

    const screens = usePluginStore.getState().mobileScreens;
    expect(screens.has("monitor:monitoring")).toBe(true);
    expect(screens.has("monitoring")).toBe(false);

    unloadPlugin("monitor");
    expect(usePluginStore.getState().mobileScreens.size).toBe(0);
  });
});
