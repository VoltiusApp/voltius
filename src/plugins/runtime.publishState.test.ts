import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { loadPlugin, unloadPlugin, setPluginActive, getExposedApi } from "./runtime";
import { usePluginStateStore } from "@/stores/pluginStateStore";
import type { PluginManifest, PluginRegisterFn } from "./api";

function manifest(perms: string[]): PluginManifest {
  return { id: "t", name: "T", version: "1", permissions: perms };
}

let captured: import("./api").PluginAPI;
const register: PluginRegisterFn = (api) => { captured = api; };

beforeEach(() => usePluginStateStore.setState({ values: new Map() }));
afterEach(() => { try { unloadPlugin("t"); } catch { /* noop */ } });

describe("api.ui.publishState", () => {
  test("publishes into the host store, namespaced by plugin id", () => {
    loadPlugin(manifest(["ui"]), register, true, false);
    captured.ui.publishState("sync-state", { status: "idle" });
    expect(usePluginStateStore.getState().read("t", "sync-state")).toEqual({ status: "idle" });
  });

  test("requires the ui permission", () => {
    loadPlugin(manifest([]), register, true, false);
    expect(() => captured.ui.publishState("sync-state", {})).toThrow(/requires permission/);
  });

  test("unloadPlugin clears published state", () => {
    loadPlugin(manifest(["ui"]), register, true, false);
    captured.ui.publishState("sync-state", { status: "idle" });
    unloadPlugin("t");
    expect(usePluginStateStore.getState().read("t", "sync-state")).toBeUndefined();
  });

  test("disabling a plugin clears its published state", () => {
    loadPlugin(manifest(["ui"]), register, true, false);
    captured.ui.publishState("sync-state", { status: "idle" });
    setPluginActive("t", false);
    expect(usePluginStateStore.getState().read("t", "sync-state")).toBeUndefined();
  });
});

describe("api.plugins.expose / getExposedApi", () => {
  // Mirrors gist-sync's index.ts: expose() called unconditionally at the top
  // of register(), so it re-fires on every reactivation.
  const exposingRegister: PluginRegisterFn = (api) => {
    captured = api;
    api.plugins.expose({ ping: () => "pong" });
  };

  test("getExposedApi returns what the plugin exposed", () => {
    loadPlugin(manifest([]), exposingRegister, true, false);
    expect(getExposedApi("t")).toEqual({ ping: expect.any(Function) });
  });

  test("disabling a plugin makes its exposed API unreachable via getExposedApi", () => {
    loadPlugin(manifest([]), exposingRegister, true, false);
    expect(getExposedApi("t")).not.toBeNull();

    setPluginActive("t", false);

    expect(getExposedApi("t")).toBeNull();
  });

  test("re-enabling a plugin restores its exposed API (disable/enable round trip)", () => {
    loadPlugin(manifest([]), exposingRegister, true, false);
    setPluginActive("t", false);
    expect(getExposedApi("t")).toBeNull();

    setPluginActive("t", true);

    expect(getExposedApi("t")).toEqual({ ping: expect.any(Function) });
  });

  test("unloadPlugin clears the exposed API", () => {
    loadPlugin(manifest([]), exposingRegister, true, false);
    unloadPlugin("t");
    expect(getExposedApi("t")).toBeNull();
  });
});
