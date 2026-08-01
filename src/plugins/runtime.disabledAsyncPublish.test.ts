import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { loadPlugin, unloadPlugin, setPluginActive, getExposedApi } from "./runtime";
import { usePluginStore } from "@/stores/pluginStore";
import { usePluginStateStore } from "@/stores/pluginStateStore";
import { useNotificationStore } from "@/stores/notificationStore";
import type { PluginAPI, PluginManifest, PluginRegisterFn } from "./api";

// Teardown is one-shot, so anything register() scheduled asynchronously lands after
// it. gist-sync's init() does exactly this: isConfigured().then(publishGistState).

function manifest(id: string): PluginManifest {
  return {
    id, name: id, version: "1",
    permissions: ["ui", "notifications", "omni-commands", "settings-page"],
  };
}

let captured: PluginAPI | null = null;

const lateRegister: PluginRegisterFn = (api) => {
  captured = api;
  void Promise.resolve().then(() => {
    api.ui.publishState("state", { status: "leaked" });
    api.plugins.expose({ ping: () => "pong" });
    api.notifications.toast("late");
    api.omni.register({
      id: "late-cmd", label: "Late", icon: "x", keybinding: "ctrl+j",
      execute: () => { executed = true; },
    });
  });
  return () => {};
};

let executed = false;

function pressCtrlJ(): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true, cancelable: true }),
  );
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  captured = null;
  executed = false;
  usePluginStore.setState({ omniCommands: new Map(), settingsPages: new Map() });
  usePluginStateStore.setState({ values: new Map() });
  useNotificationStore.setState({ toasts: [] });
});
afterEach(() => {
  try { unloadPlugin("d"); } catch { /* noop */ }
});

describe("a disabled plugin's asynchronous side effects", () => {
  test("cannot publish state after a disabled load", async () => {
    loadPlugin(manifest("d"), lateRegister, false, false);
    await flush();
    expect(usePluginStateStore.getState().read("d", "state")).toBeUndefined();
  });

  test("cannot expose its API after a disabled load", async () => {
    loadPlugin(manifest("d"), lateRegister, false, false);
    await flush();
    expect(getExposedApi("d")).toBeNull();
  });

  test("cannot raise a toast after a disabled load", async () => {
    loadPlugin(manifest("d"), lateRegister, false, false);
    await flush();
    expect(useNotificationStore.getState().toasts).toHaveLength(0);
  });

  test("cannot make a keybinding live after a disabled load", async () => {
    loadPlugin(manifest("d"), lateRegister, false, false);
    await flush();
    pressCtrlJ();
    expect(executed).toBe(false);
  });

  test("cannot publish state after being disabled at runtime", async () => {
    loadPlugin(manifest("d"), lateRegister, true, false);
    await flush();
    setPluginActive("d", false);

    captured!.ui.publishState("state", { status: "leaked" });
    captured!.plugins.expose({ ping: () => "pong" });
    captured!.notifications.toast("late");

    expect(usePluginStateStore.getState().read("d", "state")).toBeUndefined();
    expect(getExposedApi("d")).toBeNull();
    expect(useNotificationStore.getState().toasts).toHaveLength(0);
  });

  test("an active plugin's asynchronous side effects still land", async () => {
    loadPlugin(manifest("d"), lateRegister, true, false);
    await flush();

    expect(usePluginStateStore.getState().read("d", "state")).toEqual({ status: "leaked" });
    expect(getExposedApi("d")).not.toBeNull();
    expect(useNotificationStore.getState().toasts).toHaveLength(1);
    pressCtrlJ();
    expect(executed).toBe(true);
  });

  test("re-enabling restores the plugin's ability to publish", async () => {
    loadPlugin(manifest("d"), lateRegister, false, false);
    await flush();
    setPluginActive("d", true);
    await flush();

    expect(usePluginStateStore.getState().read("d", "state")).toEqual({ status: "leaked" });
    expect(getExposedApi("d")).not.toBeNull();
  });
});
