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
import { appFetch } from "@/services/http";
import { mergeBrowseCatalog } from "@/plugins/floor";
import type { SeededEntry } from "./seededTombstoneStore";

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
  vi.mocked(appFetch).mockClear();
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
    if (cmd === "plugin_fetch_url") {
      return args.url!.endsWith("manifest.json")
        ? JSON.stringify({ id: "plugin-other", name: "Other", version: "1.0.0", permissions: [] })
        : "export default () => {}";
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
  expect(appFetch).not.toHaveBeenCalled();
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

// A remote catalogue entry could spoof `builtin: true` to steer a click into the
// trusted, no-hash-check floor path for a plugin that isn't actually the built-in it
// claims to be. installPlugin must not take that path on the flag alone — it re-checks
// local state (a real seeded artifact, and currently tombstoned) before routing there.

test("installPlugin ignores a spoofed builtin flag for an id that isn't a seeded artifact", async () => {
  const spoofed = floorPlugin({ id: "plugin-not-seeded", repo: "attacker/plugin" });

  await useMarketplaceStore.getState().installPlugin(spoofed);

  // Falls through to the normal network-fetch path instead of the floor.
  const fetched = h.invoke.mock.calls.filter(([cmd]) => cmd === "plugin_fetch_url");
  expect(fetched.length).toBeGreaterThan(0);
  expect(h.loadPlugin).toHaveBeenCalledOnce();
  const [, , , trusted] = h.loadPlugin.mock.calls[0];
  expect(trusted).toBe(false);
});

// fetchManifest and installPlugin share one `takesFloorPath` predicate so their
// gates cannot drift: whichever path installPlugin takes for a given plugin,
// fetchManifest must agree — otherwise the consent modal could show one
// manifest's permissions while installPlugin executes a different one.
test("fetchManifest and installPlugin agree on the floor path for a spoofed builtin flag", async () => {
  const spoofed = floorPlugin({ id: "plugin-not-seeded", repo: "attacker/plugin" });

  const { manifestText } = await useMarketplaceStore.getState().fetchManifest(spoofed);
  expect(h.invoke).not.toHaveBeenCalledWith("plugin_seeded_read", expect.anything());
  expect(manifestText).not.toBe(JSON.stringify(SEEDED_MANIFEST));

  h.invoke.mockClear();
  h.loadPlugin.mockClear();
  await useMarketplaceStore.getState().installPlugin(spoofed);
  const fetched = h.invoke.mock.calls.filter(([cmd]) => cmd === "plugin_fetch_url");
  expect(fetched.length).toBeGreaterThan(0);
  const seededRead = h.invoke.mock.calls.filter(([cmd]) => cmd === "plugin_seeded_read");
  expect(seededRead.length).toBe(0);
});

// The Browse row mergeBrowseCatalog picks is the exact object installPlugin (and
// fetchManifest) receive — this proves the version-precedence decision in
// mergeBrowseCatalog actually controls which path installPlugin takes, not just
// which row gets displayed.

function seededMap(): Map<string, SeededEntry> {
  return new Map([["plugin-docker", { folder: "docker", manifest: SEEDED_MANIFEST }]]);
}

function catalogEntry(over: Partial<MarketplacePlugin> = {}): MarketplacePlugin {
  return {
    id: "plugin-docker", name: "Docker", author: "Voltius", description: "d",
    repo: "voltiusApp/plugin-docker", version: "1.2.0", tags: [], theme: false, sourceId: "voltius",
    ...over,
  };
}

test("a catalogue row older than the seeded manifest routes through the floor, not the network", async () => {
  const row = mergeBrowseCatalog([catalogEntry({ version: "1.0.0" })], seededMap(), ["plugin-docker"], "2.5.0")[0];
  expect(row.builtin).toBe(true);

  await useMarketplaceStore.getState().installPlugin(row);

  expect(h.invoke).not.toHaveBeenCalledWith("plugin_fetch_url", expect.anything());
  expect(h.loadPlugin).toHaveBeenCalledOnce();
  expect(h.loadPlugin.mock.calls[0][3]).toBe(true); // trusted
});

test("a catalogue row tying the seeded manifest's version routes through the floor, not the network", async () => {
  const row = mergeBrowseCatalog([catalogEntry({ version: "1.1.0" })], seededMap(), ["plugin-docker"], "2.5.0")[0];
  expect(row.builtin).toBe(true);

  await useMarketplaceStore.getState().installPlugin(row);

  expect(h.invoke).not.toHaveBeenCalledWith("plugin_fetch_url", expect.anything());
  expect(h.loadPlugin).toHaveBeenCalledOnce();
  expect(h.loadPlugin.mock.calls[0][3]).toBe(true); // trusted
});

test("a catalogue row strictly newer than the seeded manifest routes through the network, not the floor", async () => {
  const row = mergeBrowseCatalog([catalogEntry({ version: "1.2.0" })], seededMap(), ["plugin-docker"], "2.5.0")[0];
  expect(row.builtin).toBeUndefined();

  await useMarketplaceStore.getState().installPlugin(row);

  const fetched = h.invoke.mock.calls.filter(([cmd]) => cmd === "plugin_fetch_url");
  expect(fetched.length).toBeGreaterThan(0);
  expect(h.invoke).not.toHaveBeenCalledWith("plugin_seeded_read", expect.anything());
  expect(h.loadPlugin).toHaveBeenCalledOnce();
  expect(h.loadPlugin.mock.calls[0][3]).toBe(false); // trusted
});

test("installPlugin ignores a spoofed builtin flag for a real seeded id that isn't tombstoned", async () => {
  useSeededTombstoneStore.setState({ removed: [] }); // plugin-docker is currently active, not removed
  const spoofed = floorPlugin({ repo: "attacker/plugin-docker" });

  await useMarketplaceStore.getState().installPlugin(spoofed);

  const fetched = h.invoke.mock.calls.filter(([cmd]) => cmd === "plugin_fetch_url");
  expect(fetched.length).toBeGreaterThan(0);
  expect(h.loadPlugin).toHaveBeenCalledOnce();
  const [, , , trusted] = h.loadPlugin.mock.calls[0];
  expect(trusted).toBe(false);
});
