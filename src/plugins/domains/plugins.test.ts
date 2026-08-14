import { describe, it, expect, vi, beforeEach } from "vitest";

const marketplace = {
  appVersion: "1.0.0",
  sources: [{ id: "voltius", name: "Voltius Marketplace", url: "https://x/plugins.json", enabled: true, deletable: false }],
  catalog: [
    { id: "acme", name: "Acme", author: "a", description: "d", repo: "r", version: "2.0.0", tags: [], theme: false, sourceId: "voltius" },
  ],
  installedMeta: [{ id: "acme", version: "1.0.0", sourceId: "voltius", hash: "abc" }],
  loadAppVersion: vi.fn(async () => {}),
  loadSources: vi.fn(async () => {}),
  loadInstalledMeta: vi.fn(async () => {}),
  fetchCatalog: vi.fn(async () => {}),
  installPlugin: vi.fn(async () => {}),
  fetchManifest: vi.fn(async () => ({ manifest: { id: "acme", name: "Acme", version: "2.0.0", permissions: [] }, manifestText: "{}" })),
  uninstallPlugin: vi.fn(async () => {}),
  uninstallSeededPlugin: vi.fn(async () => {}),
  addSource: vi.fn(async () => {}),
  removeSource: vi.fn(async () => {}),
};
vi.mock("@/stores/marketplaceStore", () => ({
  useMarketplaceStore: { getState: () => marketplace },
}));

const registry = { isEnabled: vi.fn(() => true), setEnabled: vi.fn(async () => {}) };
vi.mock("@/stores/pluginRegistryStore", () => ({
  usePluginRegistryStore: { getState: () => registry },
}));

const storage = new Map<string, unknown>();
vi.mock("@/plugins/runtime", () => ({
  getLoadedPlugins: () => [
    {
      id: "acme", name: "Acme", version: "1.0.0", permissions: ["storage"],
      contributes: { configuration: { autoCheck: { type: "boolean", default: true, description: "d" } } },
    },
    { id: "plain", name: "Plain", version: "1.0.0", permissions: [] },
  ],
  setPluginActive: vi.fn(),
  pluginStorageGet: async (id: string, key: string) => storage.get(`${id}::${key}`) ?? null,
  pluginStorageSet: async (id: string, key: string, v: unknown) => { storage.set(`${id}::${key}`, v); },
}));

vi.mock("@/stores/seededTombstoneStore", () => ({
  loadSeededEntries: async () => new Map([["plain", { id: "plain", version: "1.0.0" }]]),
}));

import {
  listPlugins, setPluginEnabled, readPluginConfig, writePluginConfig,
  removeSource, updatePlugin,
} from "./plugins";

beforeEach(() => { storage.clear(); vi.clearAllMocks(); });

describe("plugin domain", () => {
  it("lists plugins with origin, hash and available update", async () => {
    const list = await listPlugins();
    const acme = list.find((p) => p.id === "acme")!;
    expect(acme.origin).toBe("catalog");
    expect(acme.hash).toBe("abc");
    expect(acme.updateAvailable).toBe("2.0.0");
    expect(acme.configurable).toEqual(["autoCheck"]);
    expect(list.find((p) => p.id === "plain")!.origin).toBe("seeded");
  });

  it("refuses an unknown id rather than throwing", async () => {
    expect(await setPluginEnabled("nope", true)).toEqual({ ok: false, error: expect.stringContaining("nope") });
  });

  it("reads declared configuration, falling back to declared defaults", async () => {
    const r = await readPluginConfig("acme");
    expect(r).toEqual({ ok: true, result: { autoCheck: true } });
  });

  it("refuses configuration on a plugin that declares none", async () => {
    const r = await readPluginConfig("plain");
    expect(r.ok).toBe(false);
  });

  it("refuses an undeclared key", async () => {
    const r = await writePluginConfig("acme", "nope", 1);
    expect(r).toEqual({ ok: false, error: expect.stringContaining("nope") });
  });

  it("refuses a value of the wrong declared type", async () => {
    const r = await writePluginConfig("acme", "autoCheck", "yes");
    expect(r).toEqual({ ok: false, error: expect.stringContaining("boolean") });
  });

  it("writes a declared key and reads back the effective value", async () => {
    expect(await writePluginConfig("acme", "autoCheck", false))
      .toEqual({ ok: true, result: { key: "autoCheck", effective: false } });
  });

  it("refuses to remove a non-deletable source", async () => {
    const r = await removeSource("voltius");
    expect(r.ok).toBe(false);
    expect(marketplace.removeSource).not.toHaveBeenCalled();
  });

  it("refuses an update when the catalog has nothing newer", async () => {
    marketplace.installedMeta = [{ id: "acme", version: "2.0.0", sourceId: "voltius", hash: "abc" }];
    const r = await updatePlugin("acme");
    expect(r.ok).toBe(false);
    marketplace.installedMeta = [{ id: "acme", version: "1.0.0", sourceId: "voltius", hash: "abc" }];
  });
});
