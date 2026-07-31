import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { loadPlugin, unloadPlugin, setPluginActive, getExposedApi } from "./runtime";
import { injectPluginStyle } from "./importPluginModule";
import { usePluginStore } from "@/stores/pluginStore";
import { usePluginStateStore } from "@/stores/pluginStateStore";
import type { PluginManifest, PluginRegisterFn } from "./api";

// Every loader (loadSeededPlugins, loadInstalledPlugins, installPlugin, the seeded
// floor) passes the user's enable/disable override straight into loadPlugin, so a
// plugin the user disabled is re-loaded as active=false on EVERY boot. Nothing about
// that path may leave a contribution live.

function manifest(id: string): PluginManifest {
  return { id, name: id, version: "1", permissions: ["ui", "right-panel", "settings-page", "omni-commands"] };
}

// Mirrors a real first-party plugin: declarative contributions come back in the
// cleanup, while a settings page is registered imperatively and deliberately left
// out of it (setPluginActive's contract — a disabled plugin still has settings).
const register: PluginRegisterFn = (api) => {
  api.plugins.expose({ ping: () => "pong" });
  api.ui.registerSettingsPage({ id: "settings", label: "S", icon: "x", component: () => null });
  const disposeSection = api.ui.registerRightPanelSection({
    id: "panel", label: "Panel", icon: "lucide:box", component: () => null,
  });
  api.ui.publishState("state", { status: "idle" });
  api.omni.register({
    id: "cmd", label: "Cmd", icon: "x", keybinding: "ctrl+k",
    execute: () => { executed = true; },
  });
  return () => disposeSection?.();
};

let executed = false;

function pressCtrlK(): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }),
  );
}

function styleTextFor(id: string): string | null {
  return document.getElementById(`voltius-plugin-style-${id}`)?.textContent ?? null;
}

beforeEach(() => {
  executed = false;
  usePluginStore.setState({ rightPanelSections: new Map(), settingsPages: new Map(), omniCommands: new Map() });
  usePluginStateStore.setState({ values: new Map() });
});
afterEach(() => {
  try { unloadPlugin("d"); } catch { /* noop */ }
});

describe("loading a plugin while user-disabled", () => {
  test("does not leave its exposed API reachable", () => {
    loadPlugin(manifest("d"), register, false, false);
    expect(getExposedApi("d")).toBeNull();
  });

  test("does not leave its stylesheet injected", () => {
    injectPluginStyle("d", ".d{color:red}");
    loadPlugin(manifest("d"), register, false, false, ".d{color:red}");
    expect(styleTextFor("d")).toBeNull();
  });

  test("does not leave its right-panel section in the rail", () => {
    loadPlugin(manifest("d"), register, false, false);
    expect(usePluginStore.getState().rightPanelSections.size).toBe(0);
  });

  test("does not leave its omni keybinding live", () => {
    loadPlugin(manifest("d"), register, false, false);
    pressCtrlK();
    expect(executed).toBe(false);
  });

  test("does not leave its published state readable", () => {
    loadPlugin(manifest("d"), register, false, false);
    expect(usePluginStateStore.getState().read("d", "state")).toBeUndefined();
  });

  test("keeps imperative registrations that are meant to survive disable", () => {
    loadPlugin(manifest("d"), register, false, false);
    expect(usePluginStore.getState().settingsPages.has("d:settings")).toBe(true);
  });

  test("enabling afterwards restores everything", () => {
    injectPluginStyle("d", ".d{color:red}");
    loadPlugin(manifest("d"), register, false, false, ".d{color:red}");

    setPluginActive("d", true);

    expect(getExposedApi("d")).toEqual({ ping: expect.any(Function) });
    expect(styleTextFor("d")).toBe(".d{color:red}");
    expect(usePluginStore.getState().rightPanelSections.has("d:panel")).toBe(true);
    expect(usePluginStateStore.getState().read("d", "state")).toEqual({ status: "idle" });
    pressCtrlK();
    expect(executed).toBe(true);
  });

  test("an active load is unaffected", () => {
    injectPluginStyle("d", ".d{color:red}");
    loadPlugin(manifest("d"), register, true, false, ".d{color:red}");
    expect(getExposedApi("d")).not.toBeNull();
    expect(styleTextFor("d")).toBe(".d{color:red}");
    expect(usePluginStore.getState().rightPanelSections.has("d:panel")).toBe(true);
  });
});
