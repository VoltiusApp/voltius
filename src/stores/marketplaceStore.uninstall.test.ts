import { test, expect, vi, beforeEach } from "vitest";

// A dedicated file so the seeded-manifest-id cache in seededTombstoneStore.ts
// (module-scoped, populated once per module instance) stays consistent across
// every test here: folder "docker" is the only seeded artifact, keyed to
// manifest id "plugin-docker".
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
  pluginRegisterOf: (mod: { default?: unknown; register?: unknown }) => mod.default ?? mod.register,
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: vi.fn() }));
vi.mock("@/stores/pluginRegistryStore", () => ({
  usePluginRegistryStore: { getState: () => ({ isEnabled: () => true }) },
}));

import { useMarketplaceStore, type MarketplacePlugin } from "./marketplaceStore";
import { useSeededTombstoneStore } from "./seededTombstoneStore";

const MANIFEST = JSON.stringify({ id: "p1", name: "P1", version: "1.0.0", permissions: [] });

function basePlugin(over: Partial<MarketplacePlugin> = {}): MarketplacePlugin {
  return {
    id: "p1", name: "P1", author: "a", description: "d",
    repo: "https://example.com/p1", version: "1.0.0",
    tags: [], theme: false, sourceId: "voltius", ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useMarketplaceStore.setState({ installedMeta: [], installing: new Set() });
  useSeededTombstoneStore.setState({ removed: [] });
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, string> = {}) => {
    if (cmd === "plugins_list_seeded") return ["docker"];
    if (cmd === "plugin_seeded_read" && args.id === "docker" && args.filename === "manifest.json") {
      return JSON.stringify({ id: "plugin-docker" });
    }
    if (cmd === "plugin_fetch_url") return args.url!.endsWith("manifest.json") ? MANIFEST : "export default () => {}";
    return undefined;
  });
});

test("uninstalling an external id that shadows a seeded plugin tombstones it", async () => {
  useMarketplaceStore.setState({
    installedMeta: [{ id: "plugin-docker", version: "1.0.0", sourceId: "voltius", hash: null }],
  });

  await useMarketplaceStore.getState().uninstallPlugin("plugin-docker");

  expect(h.unloadPlugin).toHaveBeenCalledWith("plugin-docker");
  expect(useSeededTombstoneStore.getState().isRemoved("plugin-docker")).toBe(true);
});

test("uninstalling an external id with no seeded counterpart does not tombstone it", async () => {
  useMarketplaceStore.setState({
    installedMeta: [{ id: "p1", version: "1.0.0", sourceId: "voltius", hash: null }],
  });

  await useMarketplaceStore.getState().uninstallPlugin("p1");

  expect(useSeededTombstoneStore.getState().isRemoved("p1")).toBe(false);
});

test("installing a plugin clears any tombstone recorded for its id", async () => {
  useSeededTombstoneStore.setState({ removed: ["plugin-docker"] });
  // installPlugin requires the fetched manifest's id to equal the catalogue id.
  const base = h.invoke.getMockImplementation()!;
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, string> = {}) => (
    cmd === "plugin_fetch_url" && args.url!.endsWith("manifest.json")
      ? JSON.stringify({ id: "plugin-docker", name: "Docker", version: "1.0.0", permissions: [] })
      : base(cmd, args)
  ));

  await useMarketplaceStore.getState().installPlugin(basePlugin({ id: "plugin-docker" }));

  expect(useSeededTombstoneStore.getState().isRemoved("plugin-docker")).toBe(false);
});

test("uninstallSeededPlugin unloads the plugin and tombstones it without deleting from disk", async () => {
  await useMarketplaceStore.getState().uninstallSeededPlugin("plugin-docker");

  expect(h.unloadPlugin).toHaveBeenCalledWith("plugin-docker");
  expect(useSeededTombstoneStore.getState().isRemoved("plugin-docker")).toBe(true);
  expect(h.invoke).not.toHaveBeenCalledWith("plugin_delete", expect.anything());
});

// An id can render in the "seeded" UI bucket (loaded, no installedMeta entry)
// without a real seeded artifact on disk — e.g. installedMeta lost its record
// of an external plugin because the sync came from another device, or the
// meta file failed to parse. uninstallSeededPlugin must fall through to a real
// delete in that case, or the plugin comes back on every boot.
test("uninstallSeededPlugin with no seeded artifact falls through to a real delete", async () => {
  await useMarketplaceStore.getState().uninstallSeededPlugin("orphan-plugin");

  expect(h.unloadPlugin).toHaveBeenCalledWith("orphan-plugin");
  expect(h.invoke).toHaveBeenCalledWith("plugin_delete", { id: "orphan-plugin" });
  expect(useSeededTombstoneStore.getState().isRemoved("orphan-plugin")).toBe(false);
});
