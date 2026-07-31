import { describe, test, expect, beforeEach } from "vitest";
import { usePluginStateStore } from "./pluginStateStore";

beforeEach(() => usePluginStateStore.setState({ values: new Map() }));

describe("pluginStateStore", () => {
  test("publish then read returns the published value", () => {
    usePluginStateStore.getState().publish("plugin-gist-sync", "sync-state", { status: "idle" });
    expect(usePluginStateStore.getState().read("plugin-gist-sync", "sync-state")).toEqual({ status: "idle" });
  });

  test("reading an absent key returns undefined, not throwing", () => {
    expect(usePluginStateStore.getState().read("plugin-gist-sync", "sync-state")).toBeUndefined();
    expect(usePluginStateStore.getState().read("nonexistent-plugin", "nonexistent-key")).toBeUndefined();
  });

  test("keys are namespaced by plugin id — same key, different plugins, no collision", () => {
    usePluginStateStore.getState().publish("plugin-a", "sync-state", { status: "syncing" });
    usePluginStateStore.getState().publish("plugin-b", "sync-state", { status: "error" });
    expect(usePluginStateStore.getState().read("plugin-a", "sync-state")).toEqual({ status: "syncing" });
    expect(usePluginStateStore.getState().read("plugin-b", "sync-state")).toEqual({ status: "error" });
  });

  test("clearPlugin removes only that plugin's published keys", () => {
    usePluginStateStore.getState().publish("plugin-a", "sync-state", { status: "syncing" });
    usePluginStateStore.getState().publish("plugin-a", "other-key", 42);
    usePluginStateStore.getState().publish("plugin-b", "sync-state", { status: "error" });

    usePluginStateStore.getState().clearPlugin("plugin-a");

    expect(usePluginStateStore.getState().read("plugin-a", "sync-state")).toBeUndefined();
    expect(usePluginStateStore.getState().read("plugin-a", "other-key")).toBeUndefined();
    expect(usePluginStateStore.getState().read("plugin-b", "sync-state")).toEqual({ status: "error" });
  });

  test("clearPlugin on a plugin with no published state is a no-op", () => {
    expect(() => usePluginStateStore.getState().clearPlugin("never-published")).not.toThrow();
  });
});
