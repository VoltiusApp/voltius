import { test, expect, vi, beforeEach } from "vitest";

// The seeded-manifest cache in seededTombstoneStore.ts is module-scoped and populated
// once, so every test in this file shares one seeded artifact: folder "docker" keyed
// to manifest id "plugin-docker" — mirroring the real shipped bundle's shape.
const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  loadPlugin: vi.fn(),
  unloadPlugin: vi.fn(),
  importPluginModule: vi.fn(async () => ({ default: () => {} })),
  getVersion: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: h.getVersion }));
vi.mock("@/plugins/runtime", () => ({ loadPlugin: h.loadPlugin, unloadPlugin: h.unloadPlugin }));
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

const SEEDED_MANIFEST = { id: "plugin-docker", name: "Docker", version: "1.1.0", permissions: ["docker:read"] };

function floorPlugin(over: Partial<MarketplacePlugin> = {}): MarketplacePlugin {
  return {
    id: "plugin-docker", name: "Docker", author: "Voltius", description: "d",
    repo: "", version: "1.1.0", tags: [], theme: false, sourceId: "builtin", builtin: true,
    ...over,
  };
}

h.getVersion.mockResolvedValue("2.5.0");

beforeEach(() => {
  h.invoke.mockClear();
  h.loadPlugin.mockClear();
  h.importPluginModule.mockClear();
  useMarketplaceStore.setState({ installedMeta: [], installing: new Set() });
  useSeededTombstoneStore.setState({ removed: ["plugin-docker"] });
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, string> = {}) => {
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
    return undefined;
  });
});

test("installPlugin routes a builtin entry through the floor: loads it trusted and clears the tombstone", async () => {
  await useMarketplaceStore.getState().installPlugin(floorPlugin());

  expect(h.loadPlugin).toHaveBeenCalledOnce();
  const [manifest, , active, trusted] = h.loadPlugin.mock.calls[0];
  expect(manifest.id).toBe("plugin-docker");
  expect(active).toBe(true);
  expect(trusted).toBe(true);
  expect(useSeededTombstoneStore.getState().isRemoved("plugin-docker")).toBe(false);
});

test("the floor path makes no network call", async () => {
  await useMarketplaceStore.getState().installPlugin(floorPlugin());

  const networked = h.invoke.mock.calls.filter(([cmd]) => cmd === "plugin_fetch_url");
  expect(networked).toEqual([]);
});

test("the floor path performs no hash check and does not gate on minAppVersion", async () => {
  // getVersion is fixed to 2.5.0 for the whole module; a floor entry carries no
  // minAppVersion at all, so there is nothing for satisfiesMinAppVersion to reject.
  await expect(useMarketplaceStore.getState().installPlugin(floorPlugin())).resolves.toBeUndefined();
  expect(h.loadPlugin).toHaveBeenCalledOnce();
});

test("the floor path never writes installedMeta — the plugin goes back to being purely seeded", async () => {
  await useMarketplaceStore.getState().installPlugin(floorPlugin());
  expect(useMarketplaceStore.getState().installedMeta.find((m) => m.id === "plugin-docker")).toBeUndefined();
});

test("fetchManifest reads a builtin's manifest from the seeded resource, not the network", async () => {
  const { manifest } = await useMarketplaceStore.getState().fetchManifest(floorPlugin());
  expect(manifest.id).toBe("plugin-docker");
  expect(h.invoke).toHaveBeenCalledWith("plugin_seeded_read", { id: "docker", filename: "manifest.json" });
  expect(h.invoke).not.toHaveBeenCalledWith("plugin_fetch_url", expect.anything());
});
