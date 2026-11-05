import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), loaded: [] as { id: string }[] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "2.5.0" }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: vi.fn() }));
vi.mock("@/plugins/runtime", () => ({
  getLoadedPlugins: () => h.loaded,
  loadPlugin: vi.fn(),
  unloadPlugin: vi.fn(),
}));

import { useMarketplaceStore, PluginInstallManagedError, type MarketplacePlugin } from "./marketplaceStore";
import { usePolicyStore } from "./policyStore";

const plugin = (id: string): MarketplacePlugin => ({
  id, name: id, author: "a", description: "d", repo: "https://example.com/p", version: "1.0.0",
  tags: [], theme: false, sourceId: "voltius",
});

const setPolicy = (policy: Record<string, unknown>, defaults: Record<string, unknown> = {}) =>
  usePolicyStore.setState({ machine: { policy, defaults } });

const install = (id: string) => useMarketplaceStore.getState().installPlugin(plugin(id));

beforeEach(() => {
  h.invoke.mockReset();
  h.invoke.mockRejectedValue(new Error("network reached"));
  h.loaded = [];
  useMarketplaceStore.setState({ installedMeta: [], installing: new Set() });
  setPolicy({});
});

test("install_refused_when_not_allowed", async () => {
  setPolicy({ "plugins.allowInstall": false });
  await expect(install("plugin-docker")).rejects.toBeInstanceOf(PluginInstallManagedError);
  expect(h.invoke).not.toHaveBeenCalled();
});

test("listed_id_installs_when_not_allowed", async () => {
  setPolicy({ "plugins.allowInstall": false, "plugins.install": ["plugin-docker"] });
  await expect(install("plugin-docker")).rejects.toThrow("network reached");
});

test("default_listed_id_installs_when_not_allowed", async () => {
  setPolicy({ "plugins.allowInstall": false }, { "plugins.install": ["plugin-docker"] });
  await expect(install("plugin-docker")).rejects.toThrow("network reached");
});

test("update_of_installed_passes", async () => {
  setPolicy({ "plugins.allowInstall": false });
  useMarketplaceStore.setState({ installedMeta: [{ id: "p1", version: "0.9.0", sourceId: "voltius", hash: "x" }] as never });
  await expect(install("p1")).rejects.toThrow("network reached");
});

test("update_of_loaded_plugin_passes", async () => {
  setPolicy({ "plugins.allowInstall": false });
  h.loaded = [{ id: "p2" }];
  await expect(install("p2")).rejects.toThrow("network reached");
});

test("allowed_by_default", async () => {
  await expect(install("p3")).rejects.toThrow("network reached");
});
