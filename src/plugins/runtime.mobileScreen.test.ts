import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { loadPlugin, unloadPlugin, setPluginActive } from "./runtime";
import { usePluginStore } from "@/stores/pluginStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
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

let captured: import("./api").PluginAPI;
const register: PluginRegisterFn = (api) => {
  captured = api;
  return api.ui.registerMobileScreen(screen);
};

beforeEach(() => usePluginStore.setState({ mobileScreens: new Map() }));
afterEach(() => { try { unloadPlugin("t"); } catch { /* noop */ } });

describe("api.ui.registerMobileScreen", () => {
  test("registers under a plugin-prefixed id", () => {
    loadPlugin(manifest(["right-panel"]), register, true, false);
    expect(usePluginStore.getState().mobileScreens.has("t:metrics")).toBe(true);
    expect(usePluginStore.getState().mobileScreens.get("t:metrics")).toMatchObject({ kind: "metrics", title: "Metrics" });
  });

  test("requires the right-panel permission", () => {
    const captureOnly: PluginRegisterFn = (api) => { captured = api; };
    loadPlugin(manifest([]), captureOnly, true, false);
    expect(() => captured.ui.registerMobileScreen(screen)).toThrow(/requires permission "right-panel"/);
  });

  test("the returned cleanup unregisters the screen", () => {
    let cleanup: (() => void) | undefined;
    const captureCleanup: PluginRegisterFn = (api) => {
      cleanup = api.ui.registerMobileScreen(screen);
    };
    loadPlugin(manifest(["right-panel"]), captureCleanup, true, false);
    expect(usePluginStore.getState().mobileScreens.has("t:metrics")).toBe(true);
    cleanup?.();
    expect(usePluginStore.getState().mobileScreens.has("t:metrics")).toBe(false);
  });

  test("a disabled plugin contributes no mobile screens", () => {
    loadPlugin(manifest(["right-panel"]), register, true, false);
    expect(usePluginStore.getState().mobileScreens.has("t:metrics")).toBe(true);
    setPluginActive("t", false);
    expect(usePluginStore.getState().mobileScreens.size).toBe(0);
  });

  test("unloadPlugin removes the mobile screen", () => {
    loadPlugin(manifest(["right-panel"]), register, true, false);
    unloadPlugin("t");
    expect(usePluginStore.getState().mobileScreens.size).toBe(0);
  });
});

describe("api.ui.pushMobileScreen / focusMobileTerminal", () => {
  beforeEach(() => useMobileNavStore.setState({ tab: "hosts", stack: [], sheet: null }));

  test("pushMobileScreen pushes a stack entry", () => {
    const captureOnly: PluginRegisterFn = (api) => { captured = api; };
    loadPlugin(manifest(["ui"]), captureOnly, true, false);
    captured.ui.pushMobileScreen("docker-logs", { sessionId: "s1", containerId: "c1", containerName: "web" });
    expect(useMobileNavStore.getState().stack).toEqual([
      { kind: "docker-logs", sessionId: "s1", containerId: "c1", containerName: "web" },
    ]);
  });

  test("focusMobileTerminal switches the mobile shell to the terminal tab", () => {
    const captureOnly: PluginRegisterFn = (api) => { captured = api; };
    loadPlugin(manifest(["ui"]), captureOnly, true, false);
    captured.ui.focusMobileTerminal();
    expect(useMobileNavStore.getState().tab).toBe("terminal");
  });

  test("both require the ui permission", () => {
    const captureOnly: PluginRegisterFn = (api) => { captured = api; };
    loadPlugin(manifest([]), captureOnly, true, false);
    expect(() => captured.ui.pushMobileScreen("docker-logs")).toThrow(/requires permission "ui"/);
    expect(() => captured.ui.focusMobileTerminal()).toThrow(/requires permission "ui"/);
  });
});
