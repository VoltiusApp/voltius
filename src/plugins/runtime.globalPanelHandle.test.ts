import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { loadPlugin, unloadPlugin } from "./runtime";
import { usePluginStore } from "@/stores/pluginStore";
import { useUIStore } from "@/stores/uiStore";
import type { GlobalPanelHandle, PluginManifest, PluginRegisterFn } from "./api";

function manifest(id: string, perms: string[]): PluginManifest {
  return { id, name: id, version: "1", permissions: perms };
}

function load(id: string): GlobalPanelHandle {
  let handle!: GlobalPanelHandle;
  const register: PluginRegisterFn = (api) => {
    handle = api.ui.registerGlobalPanel({ id: "drawer", component: () => null });
  };
  loadPlugin(manifest(id, ["global-panel"]), register, true, false);
  return handle;
}

beforeEach(() => {
  usePluginStore.setState({ settingsPages: new Map(), globalPanels: new Map(), mobileScreens: new Map() });
  useUIStore.setState({ globalPanelOpen: {}, dockedPanelWidth: 0 });
});

afterEach(() => {
  try { unloadPlugin("agent"); } catch { /* noop */ }
});

describe("global panel handle", () => {
  test("exposes the host-prefixed id", () => {
    expect(load("agent").id).toBe("agent:drawer");
  });

  test("open, close, toggle and isOpen act on the prefixed id", () => {
    const handle = load("agent");
    expect(handle.isOpen()).toBe(false);

    handle.open();
    expect(useUIStore.getState().globalPanelOpen["agent:drawer"]).toBe(true);
    expect(handle.isOpen()).toBe(true);

    handle.close();
    expect(handle.isOpen()).toBe(false);

    handle.toggle();
    expect(handle.isOpen()).toBe(true);
  });

  test("is still callable as the disposer it used to return", () => {
    const handle = load("agent");
    expect(usePluginStore.getState().globalPanels.has("agent:drawer")).toBe(true);
    handle();
    expect(usePluginStore.getState().globalPanels.has("agent:drawer")).toBe(false);
  });

  test("setDockedWidth reserves shell width and disposing releases it", () => {
    const handle = load("agent");
    handle.setDockedWidth(360);
    expect(useUIStore.getState().dockedPanelWidth).toBe(360);

    handle();
    expect(useUIStore.getState().dockedPanelWidth).toBe(0);
  });

  test("disposing does not clear a docked width this handle did not set", () => {
    const handle = load("agent");
    handle.setDockedWidth(360);
    useUIStore.getState().setDockedPanelWidth(200);

    handle();
    expect(useUIStore.getState().dockedPanelWidth).toBe(200);
  });

  test("unloading releases a docked width the plugin's own cleanup did not", () => {
    const register: PluginRegisterFn = (api) => {
      api.ui.registerGlobalPanel({ id: "drawer", component: () => null }).setDockedWidth(360);
      return () => {};
    };
    loadPlugin(manifest("agent", ["global-panel"]), register, true, false);
    expect(useUIStore.getState().dockedPanelWidth).toBe(360);

    unloadPlugin("agent");
    expect(useUIStore.getState().dockedPanelWidth).toBe(0);
  });

  test("unloading leaves a docked width another plugin owns alone", () => {
    const handle = load("agent");
    handle.setDockedWidth(360);
    useUIStore.getState().setDockedPanelWidth(200);

    unloadPlugin("agent");
    expect(useUIStore.getState().dockedPanelWidth).toBe(200);
  });

  test("methods no-op once the plugin is unloaded", () => {
    const handle = load("agent");
    unloadPlugin("agent");

    handle.open();
    expect(useUIStore.getState().globalPanelOpen["agent:drawer"]).toBeFalsy();
  });
});
