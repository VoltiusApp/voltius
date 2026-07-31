import { test, expect, vi, beforeEach } from "vitest";

// Dedicated file so the seeded-manifest-id cache in seededTombstoneStore.ts
// (module-scoped, populated once per module instance) stays consistent across
// every test here: folder "docker" is the only seeded artifact, keyed to
// manifest id "plugin-docker" — mirroring marketplaceStore.floor.test.ts.
const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  loadPlugin: vi.fn(),
  unloadPlugin: vi.fn(),
  getLoadedPlugins: vi.fn(() => []),
  importPluginModule: vi.fn(async () => ({ default: () => {} })),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/plugins/runtime", () => ({
  loadPlugin: h.loadPlugin, unloadPlugin: h.unloadPlugin, getLoadedPlugins: h.getLoadedPlugins,
}));
vi.mock("@/plugins/importPluginModule", () => ({
  importPluginModule: h.importPluginModule,
  pluginRegisterOf: (mod: { default?: unknown; register?: unknown }) => mod.default ?? mod.register,
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: vi.fn() }));
vi.mock("@/stores/pluginRegistryStore", () => ({
  usePluginRegistryStore: { getState: () => ({ isEnabled: () => true }) },
}));

import { useMarketplaceStore, restoreMissingPlugins } from "./marketplaceStore";
import { useSeededTombstoneStore } from "./seededTombstoneStore";

const SEEDED_MANIFEST = { id: "plugin-docker", name: "Docker", version: "1.1.0", permissions: ["docker:read"] };

beforeEach(() => {
  h.invoke.mockClear();
  h.loadPlugin.mockClear();
  h.getLoadedPlugins.mockClear();
  h.importPluginModule.mockClear();
  h.getLoadedPlugins.mockReturnValue([]);
  useMarketplaceStore.setState({ installedMeta: [], installing: new Set(), catalog: [] });
  useSeededTombstoneStore.setState({ removed: [] });
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, string> = {}) => {
    if (cmd === "plugins_list_installed") return [];
    if (cmd === "plugins_list_seeded") return ["docker"];
    if (cmd === "plugin_seeded_read" && args.id === "docker" && args.filename === "manifest.json") {
      return JSON.stringify(SEEDED_MANIFEST);
    }
    if (cmd === "plugin_seeded_read" && args.id === "docker" && args.filename === "index.js") {
      return "export default () => {}";
    }
    if (cmd === "plugin_seeded_read" && args.id === "docker" && args.filename === "voltius.css") {
      throw new Error("no stylesheet");
    }
    // Network path (fetchCatalog / plugin_fetch_url) always fails — simulates offline.
    if (cmd === "plugin_fetch_url") throw new Error("offline");
    return undefined;
  });
});

test("offline restore falls back to the seeded floor, preserving trusted=true", async () => {
  useMarketplaceStore.setState({
    installedMeta: [{ id: "plugin-docker", version: "1.1.0", sourceId: "voltius", hash: "abc", repo: "example/plugin-docker" }],
  });

  await restoreMissingPlugins();

  expect(h.loadPlugin).toHaveBeenCalledOnce();
  const [manifest, , active, trusted] = h.loadPlugin.mock.calls[0];
  expect(manifest.id).toBe("plugin-docker");
  expect(active).toBe(true);
  expect(trusted).toBe(true);
});

test("offline restore skips the seeded floor when the id is tombstoned", async () => {
  useSeededTombstoneStore.setState({ removed: ["plugin-docker"] });
  useMarketplaceStore.setState({
    installedMeta: [{ id: "plugin-docker", version: "1.1.0", sourceId: "voltius", hash: "abc", repo: "example/plugin-docker" }],
  });

  await restoreMissingPlugins();

  expect(h.loadPlugin).not.toHaveBeenCalled();
});

test("offline restore does nothing for an id with no seeded artifact", async () => {
  useMarketplaceStore.setState({
    installedMeta: [{ id: "third-party", version: "1.0.0", sourceId: "voltius", hash: "abc", repo: "example/third-party" }],
  });

  await restoreMissingPlugins();

  expect(h.loadPlugin).not.toHaveBeenCalled();
});
