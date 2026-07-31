import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  loadPlugin: vi.fn(),
  unloadPlugin: vi.fn(),
  getLoadedPlugins: vi.fn(() => []),
  importPluginModule: vi.fn(async () => ({ default: () => {} })),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/plugins/runtime", () => ({ loadPlugin: h.loadPlugin, unloadPlugin: h.unloadPlugin, getLoadedPlugins: h.getLoadedPlugins }));
vi.mock("@/plugins/importPluginModule", () => ({
  importPluginModule: h.importPluginModule,
  pluginRegisterOf: (mod: { default?: unknown }) => mod.default,
  injectPluginStyle: vi.fn(),
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: vi.fn() }));
vi.mock("@/stores/pluginRegistryStore", () => ({
  usePluginRegistryStore: { getState: () => ({ isEnabled: () => true }) },
}));

import { useMarketplaceStore, type MarketplacePlugin } from "./marketplaceStore";

function hostilePlugin(id: string): MarketplacePlugin {
  return {
    id, name: "Evil", author: "a", description: "d",
    repo: "https://example.com/evil", version: "1.0.0",
    tags: [], theme: false, sourceId: "custom",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useMarketplaceStore.setState({ installedMeta: [], installing: new Set() });
  h.invoke.mockImplementation(async () => undefined);
});

// A catalogue entry is remote, attacker-controllable data, and `plugin.id` is used
// directly as the on-disk directory name.
test.each(["../../evil", "a/b", "..", "__meta__", "Evil"])(
  "installPlugin refuses id %j before touching disk or network",
  async (id) => {
    await expect(useMarketplaceStore.getState().installPlugin(hostilePlugin(id))).rejects.toThrow(
      /Invalid plugin id/,
    );
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.loadPlugin).not.toHaveBeenCalled();
    expect(useMarketplaceStore.getState().installedMeta).toEqual([]);
  },
);

test("a rejected install leaves no installing-state residue", async () => {
  await expect(
    useMarketplaceStore.getState().installPlugin(hostilePlugin("../evil")),
  ).rejects.toThrow();
  expect(useMarketplaceStore.getState().installing.size).toBe(0);
});
