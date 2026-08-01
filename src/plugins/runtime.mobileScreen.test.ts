import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { loadPlugin, unloadPlugin, setPluginActive, toMobileNavScreen } from "./runtime";
import { usePluginStore } from "@/stores/pluginStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { resolvePanelScreen } from "@/components/mobile/mobilePanelDispatch";
import type { PluginManifest, PluginRegisterFn, MobileScreen, PluginMobileNavEntry } from "./api";

function manifest(perms: string[]): PluginManifest {
  return { id: "t", name: "T", version: "1", permissions: perms };
}

const screen: MobileScreen = {
  id: "metrics",
  kind: "metrics",
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
    expect(usePluginStore.getState().mobileScreens.get("t:metrics")).toMatchObject({ kind: "metrics" });
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

  test("pushMobileScreen pushes the real mobileNavCore stack shape, not the plugin's own kind string", () => {
    const captureOnly: PluginRegisterFn = (api) => { captured = api; };
    loadPlugin(manifest(["ui"]), captureOnly, true, false);
    captured.ui.pushMobileScreen({ kind: "docker-logs", sessionId: "s1", containerId: "c1", containerName: "web" });
    // The nav-stack kind is "panel-docker-logs" (mobileNavCore's real union), NOT
    // "docker-logs" (the plugin's registered screen kind) — asserting the raw
    // stack shape here is what would have caught the original bug, where an
    // `as any` cast let the untranslated plugin kind reach the stack directly.
    expect(useMobileNavStore.getState().stack).toEqual([
      { kind: "panel-docker-logs", sessionId: "s1", containerId: "c1", containerName: "web" },
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
    expect(() => captured.ui.pushMobileScreen({ kind: "docker-logs", sessionId: "s1", containerId: "c1", containerName: "web" }))
      .toThrow(/requires permission "ui"/);
    expect(() => captured.ui.focusMobileTerminal()).toThrow(/requires permission "ui"/);
  });
});

describe("pushMobileScreen ↔ MobileShell dispatch round trip", () => {
  // Bridges the two independent conventions that caused the original bug:
  // runtime.ts's pushMobileScreen translates a plugin's registered screen kind
  // ("docker-logs") to mobileNavCore's stack kind ("panel-docker-logs"), and
  // MobileShell's resolvePanelScreen translates it back for the registry lookup.
  // Feeding one's real output into the other's real input is what a purely
  // one-sided unit test (like the ones above, in isolation) cannot catch: it
  // fails if either side's mapping drifts, even if each remains internally
  // self-consistent.
  test("every PluginMobileNavEntry kind resolves back to itself through MobileShell's dispatcher", () => {
    const entries: PluginMobileNavEntry[] = [
      { kind: "docker-logs", sessionId: "s1", containerId: "c1", containerName: "web" },
    ];
    for (const entry of entries) {
      const navScreen = toMobileNavScreen(entry);
      const resolved = resolvePanelScreen(navScreen);
      expect(resolved?.screenKind).toBe(entry.kind);
      expect(resolved?.props).toMatchObject({ sessionId: entry.sessionId });
    }
  });
});
