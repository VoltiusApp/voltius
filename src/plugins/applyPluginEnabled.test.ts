import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => ({})),
  active: new Map<string, boolean>(),
  manifests: [] as { id: string; defaultEnabled?: boolean }[],
  market: { installedMeta: [] as { id: string }[], catalog: [] as { id: string }[] },
  seeded: new Map<string, unknown>(),
  installPolicy: vi.fn(async () => {}),
}));
vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@/plugins/runtime", () => ({
  getLoadedPlugins: () => mocks.manifests,
  isPluginActive: (id: string) => mocks.active.get(id) ?? false,
  setPluginActive: vi.fn((id: string, on: boolean) => mocks.active.set(id, on)),
}));
vi.mock("@/stores/marketplaceStore", () => ({ useMarketplaceStore: { getState: () => mocks.market } }));
vi.mock("@/stores/seededTombstoneStore", () => ({ loadSeededEntries: async () => mocks.seeded }));
vi.mock("@/services/cliPlugins", () => ({ applyPluginInstallPolicy: mocks.installPolicy }));

import { setPluginActive } from "@/plugins/runtime";
import { applyPluginPolicy } from "./applyPluginEnabled";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { onPolicyLoaded, usePolicyStore } from "@/stores/policyStore";
import { useTeamPolicyStore } from "@/stores/teamPolicyStore";
import { withTeamPolicy } from "@/test/policy";

const lock = (policy: Record<string, unknown>) => {
  usePolicyStore.setState({ machine: { policy, defaults: {} }, server: { policy: {}, defaults: {} } });
  applyPluginPolicy();
};

describe("applyPluginPolicy", () => {
  beforeEach(() => {
    mocks.active = new Map([["plugin-docker", true], ["plugin-off", false]]);
    mocks.manifests = [{ id: "plugin-docker" }, { id: "plugin-off", defaultEnabled: false }];
    mocks.market = { installedMeta: [], catalog: [] };
    mocks.seeded = new Map();
    usePluginRegistryStore.setState({ overrides: {} });
    lock({});
    vi.mocked(setPluginActive).mockClear();
  });

  it("deactivates an active plugin the policy forces off", () => {
    lock({ "plugins.disabled": ["plugin-docker"] });
    expect(setPluginActive).toHaveBeenCalledExactlyOnceWith("plugin-docker", false);
  });

  it("brings back the user's own choice when the lock is lifted", () => {
    usePluginRegistryStore.setState({ overrides: { "plugin-docker": true } });
    lock({ "plugins.disabled": ["plugin-docker"] });
    lock({});
    expect(vi.mocked(setPluginActive).mock.calls).toEqual([["plugin-docker", false], ["plugin-docker", true]]);
    expect(usePluginRegistryStore.getState().overrides).toEqual({ "plugin-docker": true });
  });

  it("brings back the user's own choice when a team lock is lifted", () => {
    const off = onPolicyLoaded(applyPluginPolicy);
    usePluginRegistryStore.setState({ overrides: { "plugin-docker": true } });
    withTeamPolicy({ "plugins.disabled": ["plugin-docker"] });
    useTeamPolicyStore.getState().setLayer(null, "");
    off();
    expect(vi.mocked(setPluginActive).mock.calls).toEqual([["plugin-docker", false], ["plugin-docker", true]]);
    expect(usePluginRegistryStore.getState().overrides).toEqual({ "plugin-docker": true });
  });

  it("keeps a user-disabled plugin off after a forced-on lock is lifted", () => {
    usePluginRegistryStore.setState({ overrides: { "plugin-off": false } });
    lock({ "plugins.enabled": ["plugin-off"] });
    lock({});
    expect(vi.mocked(setPluginActive).mock.calls).toEqual([["plugin-off", true], ["plugin-off", false]]);
  });

  it("activates an inactive plugin the policy forces on", () => {
    lock({ "plugins.enabled": ["plugin-off"] });
    expect(setPluginActive).toHaveBeenCalledExactlyOnceWith("plugin-off", true);
  });

  it("leaves plugins alone when nothing changed", () => {
    lock({});
    expect(setPluginActive).not.toHaveBeenCalled();
  });

  it("leaves an unlocked plugin alone even when its runtime state differs from its setting", () => {
    mocks.active.set("plugin-off", true);
    usePluginRegistryStore.setState({ overrides: { "plugin-docker": false } });
    mocks.market.catalog = [{ id: "other" }];
    lock({ "plugins.disabled": ["other"] });
    lock({});
    expect(setPluginActive).not.toHaveBeenCalled();
  });

  it("turns an installed plugin back on when its lock is lifted, whatever its manifest default", () => {
    mocks.active.set("plugin-off", true);
    mocks.market.installedMeta = [{ id: "plugin-off" }];
    lock({ "plugins.disabled": ["plugin-off"] });
    lock({});
    expect(vi.mocked(setPluginActive).mock.calls).toEqual([["plugin-off", false], ["plugin-off", true]]);
  });

  it("warns once per load about ids no plugin is known by", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.market.catalog = [{ id: "plugin-catalog" }];
    mocks.seeded = new Map([["plugin-seeded", {}]]);
    lock({
      "plugins.disabled": ["docker", "plugin-docker", "plugin-catalog"],
      "plugins.enabled": ["plugin-seeded", "nope"],
    });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    expect(warn).toHaveBeenCalledWith("[policy] plugins.disabled: unknown plugin id docker");
    expect(warn).toHaveBeenCalledWith("[policy] plugins.enabled: unknown plugin id nope");
    warn.mockRestore();
  });

  it("also applies the plugin install policy", async () => {
    await vi.dynamicImportSettled();
    mocks.installPolicy.mockClear();
    lock({ "plugins.install": ["plugin-docker"] });
    await vi.dynamicImportSettled();
    expect(mocks.installPolicy).toHaveBeenCalledTimes(1);
  });
});
