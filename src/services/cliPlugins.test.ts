// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@/plugins/api";

const mocks = vi.hoisted(() => ({
  loaded: [] as { id: string; version: string }[],
  manifestPermissions: [] as string[],
  installVettedPlugin: vi.fn(),
  installPlugin: vi.fn(),
  uninstallPlugin: vi.fn(),
  setPluginEnabled: vi.fn(),
  applyPluginEnabled: vi.fn(),
}));
vi.mock("@/lib/invoke", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@/plugins/runtime", () => ({ getLoadedPlugins: () => mocks.loaded }));
vi.mock("@/plugins/applyPluginEnabled", () => ({ applyPluginEnabled: mocks.applyPluginEnabled }));
vi.mock("@/plugins/domains/plugins", () => ({
  installVettedPlugin: mocks.installVettedPlugin,
  installPlugin: mocks.installPlugin,
  uninstallPlugin: mocks.uninstallPlugin,
  setPluginEnabled: mocks.setPluginEnabled,
}));

import { applyPluginChange, applyPluginInstallPolicy, pluginInstallPolicyIdle } from "./cliPlugins";
import { usePolicyStore } from "@/stores/policyStore";
import { useAdminDefaultsStore } from "@/stores/adminDefaultsStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";

const NONE = { policy: {}, defaults: {} };
const OK = { ok: true, result: {} };
const machine = (policy: Record<string, unknown>, defaults: Record<string, unknown> = {}) =>
  usePolicyStore.setState({ machine: { policy, defaults }, server: NONE });
const install = (consentedPermissions: string[]) =>
  applyPluginChange({ action: "install", id: "plugin-docker", consentedPermissions });

describe("cliPlugins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loaded = [];
    mocks.manifestPermissions = [];
    machine({});
    useAdminDefaultsStore.setState({ applied: {}, touched: {} });
    usePluginRegistryStore.setState({ overrides: {} });
    mocks.installVettedPlugin.mockImplementation(async (_id: string, vet: (m: PluginManifest) => string | null) => {
      const refusal = vet({ permissions: mocks.manifestPermissions } as PluginManifest);
      return refusal ? { ok: false, error: refusal } : OK;
    });
    mocks.installPlugin.mockResolvedValue(OK);
    mocks.uninstallPlugin.mockResolvedValue(OK);
    mocks.setPluginEnabled.mockResolvedValue(OK);
    mocks.applyPluginEnabled.mockResolvedValue(true);
  });

  it("install_applies_with_matching_consent", async () => {
    mocks.manifestPermissions = ["docker:manage", "storage"];
    expect(await install(["docker:manage"])).toBeNull();
    expect(mocks.installVettedPlugin).toHaveBeenCalledWith("plugin-docker", expect.any(Function));
  });

  it("install_refused_when_permissions_grew", async () => {
    mocks.manifestPermissions = ["docker:manage", "terminal:write"];
    expect(await install(["docker:manage"])).toBe("permissions changed since you confirmed; run the command again");
  });

  it("failed_install_stays_pending", async () => {
    mocks.installVettedPlugin.mockResolvedValue({ ok: false, error: "HTTP 404" });
    expect(await install([])).toBe("HTTP 404");
  });

  it("install_of_a_loaded_plugin_is_done", async () => {
    mocks.loaded = [{ id: "plugin-docker", version: "1.0.0" }];
    expect(await install([])).toBeNull();
    expect(mocks.installVettedPlugin).not.toHaveBeenCalled();
  });

  it("toggle_and_remove_use_the_domain", async () => {
    mocks.loaded = [{ id: "plugin-docker", version: "1.0.0" }];
    expect(await applyPluginChange({ action: "disable", id: "plugin-docker", consentedPermissions: [] })).toBeNull();
    expect(mocks.setPluginEnabled).toHaveBeenCalledWith("plugin-docker", false);
    mocks.uninstallPlugin.mockResolvedValue({ ok: false, error: "busy" });
    expect(await applyPluginChange({ action: "remove", id: "plugin-docker", consentedPermissions: [] })).toBe("busy");
  });

  it("unknown_action_is_an_error", async () => {
    const c = { action: "upgrade", id: "plugin-docker", consentedPermissions: [] } as unknown as Parameters<typeof applyPluginChange>[0];
    expect(await applyPluginChange(c)).toBe("unknown plugin action upgrade");
  });

  it("idle_waits_for_an_in_flight_install_policy", async () => {
    machine({ "plugins.install": ["plugin-docker"] });
    let finish = (_: unknown) => {};
    mocks.installPlugin.mockReturnValue(new Promise((r) => (finish = r)));
    const run = applyPluginInstallPolicy();
    let idle = false;
    const waiting = pluginInstallPolicyIdle().then(() => (idle = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(idle).toBe(false);
    finish(OK);
    await Promise.all([run, waiting]);
    expect(idle).toBe(true);
    await expect(pluginInstallPolicyIdle()).resolves.toBeUndefined();
  });

  it("locked_install_runs_without_consent", async () => {
    mocks.manifestPermissions = ["terminal:write"];
    machine({ "plugins.install": ["plugin-docker", "plugin-loaded"] });
    mocks.loaded = [{ id: "plugin-loaded", version: "1.0.0" }];
    await applyPluginInstallPolicy();
    expect(mocks.installPlugin).toHaveBeenCalledTimes(1);
    expect(mocks.installPlugin).toHaveBeenCalledWith("plugin-docker");
    expect(mocks.installVettedPlugin).not.toHaveBeenCalled();
  });

  it("removed_default_install_is_not_reinstalled", async () => {
    machine({}, { "plugins.install": ["plugin-docker"] });
    await applyPluginInstallPolicy();
    expect(mocks.installPlugin).toHaveBeenCalledTimes(1);
    expect(useAdminDefaultsStore.getState().applied["plugins.install/plugin-docker"]).toBe(true);
    await applyPluginInstallPolicy();
    expect(mocks.installPlugin).toHaveBeenCalledTimes(1);
  });

  it("failed_default_install_is_retried", async () => {
    machine({}, { "plugins.install": ["plugin-docker"] });
    mocks.installPlugin.mockResolvedValueOnce({ ok: false, error: "offline" });
    await applyPluginInstallPolicy();
    expect(useAdminDefaultsStore.getState().applied["plugins.install/plugin-docker"]).toBeUndefined();
    await applyPluginInstallPolicy();
    expect(mocks.installPlugin).toHaveBeenCalledTimes(2);
  });

  it("unlisted_lock_becomes_removable", async () => {
    mocks.loaded = [{ id: "plugin-docker", version: "1.0.0" }];
    machine({ "plugins.install": ["plugin-docker"] });
    const remove = () => applyPluginChange({ action: "remove", id: "plugin-docker", consentedPermissions: [] });
    expect(await remove()).toBe("locked by policy");
    machine({});
    await applyPluginInstallPolicy();
    expect(mocks.uninstallPlugin).not.toHaveBeenCalled();
    expect(await remove()).toBeNull();
    expect(mocks.uninstallPlugin).toHaveBeenCalledWith("plugin-docker");
  });

  it("default_enable_respects_user_override", async () => {
    mocks.loaded = [
      { id: "a", version: "1" },
      { id: "b", version: "1" },
      { id: "c", version: "1" },
    ];
    usePluginRegistryStore.setState({ overrides: { a: false } });
    machine({}, { "plugins.enabled": ["a", "b"], "plugins.disabled": ["c", "missing"] });
    await applyPluginInstallPolicy();
    expect(mocks.applyPluginEnabled.mock.calls).toEqual([
      ["b", true],
      ["c", false],
    ]);
    const applied = useAdminDefaultsStore.getState().applied;
    expect(applied["plugins.enabled/b"]).toBe(true);
    expect(applied["plugins.disabled/c"]).toBe(true);
    expect(applied["plugins.enabled/a"]).toBeUndefined();
    await applyPluginInstallPolicy();
    expect(mocks.applyPluginEnabled).toHaveBeenCalledTimes(2);
  });
});
