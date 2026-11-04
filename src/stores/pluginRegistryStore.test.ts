import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(async () => ({})) }));
vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));

import { pluginLock, usePluginRegistryStore } from "./pluginRegistryStore";
import { usePolicyStore } from "./policyStore";

const lock = (policy: Record<string, unknown>) =>
  usePolicyStore.setState({ machine: { policy, defaults: {} }, server: { policy: {}, defaults: {} } });

describe("pluginRegistryStore policy lock", () => {
  beforeEach(() => {
    mocks.invoke.mockClear();
    usePluginRegistryStore.setState({ overrides: {} });
    lock({});
  });

  it("is unlocked without policy", () => {
    expect(pluginLock("a")).toBeNull();
    expect(usePluginRegistryStore.getState().isEnabled("a", true)).toBe(true);
  });

  it("forced-off reads disabled despite an enabled override", () => {
    lock({ "plugins.disabled": ["a"] });
    usePluginRegistryStore.setState({ overrides: { a: true } });
    expect(pluginLock("a")).toBe(false);
    expect(usePluginRegistryStore.getState().isEnabled("a", true)).toBe(false);
  });

  it("forced-on reads enabled and ignores setEnabled(false)", async () => {
    lock({ "plugins.enabled": ["a"] });
    await usePluginRegistryStore.getState().setEnabled("a", false);
    expect(usePluginRegistryStore.getState().overrides).toEqual({});
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(usePluginRegistryStore.getState().isEnabled("a", false)).toBe(true);
  });

  it("disabled wins when both lists name the plugin", () => {
    lock({ "plugins.enabled": ["a"], "plugins.disabled": ["a"] });
    expect(pluginLock("a")).toBe(false);
  });

  it("leaves unlisted plugins alone", async () => {
    lock({ "plugins.disabled": ["a"] });
    expect(pluginLock("b")).toBeNull();
    await usePluginRegistryStore.getState().setEnabled("b", false);
    expect(usePluginRegistryStore.getState().overrides).toEqual({ b: false });
  });
});
