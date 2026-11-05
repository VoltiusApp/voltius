import { describe, it, expect, vi, beforeEach } from "vitest";

const marketplace = {
  appVersion: "1.0.0",
  sources: [{ id: "voltius", name: "Voltius Marketplace", url: "https://x/plugins.json", enabled: true, deletable: false }],
  catalog: [
    { id: "acme", name: "Acme", author: "a", description: "d", repo: "r", version: "2.0.0", tags: [], theme: false, sourceId: "voltius" },
    { id: "widget", name: "Widget", author: "a", description: "d", repo: "r", version: "2.0.0", tags: [], theme: false, sourceId: "voltius" },
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
  FIRST_PARTY_SOURCE: { id: "voltius", name: "Voltius Marketplace", url: "https://x/plugins.json", enabled: true, deletable: false },
}));

const registry = { isEnabled: vi.fn(() => true), setEnabled: vi.fn(async () => {}) };
const lock = vi.hoisted(() => ({ pluginLock: vi.fn((): boolean | null => null), installLocked: vi.fn(() => false) }));
vi.mock("@/stores/pluginRegistryStore", () => ({
  usePluginRegistryStore: { getState: () => registry },
  pluginLock: lock.pluginLock,
  installLocked: lock.installLocked,
}));

const storage = new Map<string, unknown>();
vi.mock("@/plugins/runtime", () => ({
  getLoadedPlugins: () => [
    {
      id: "acme", name: "Acme", version: "1.0.0", permissions: ["storage"],
      contributes: { configuration: { autoCheck: { type: "boolean", default: true, description: "d" } } },
      defaultEnabled: false,
    },
    { id: "plain", name: "Plain", version: "1.0.0", permissions: [], defaultEnabled: false },
    { id: "widget", name: "Widget", version: "1.0.0", permissions: [] },
  ],
  setPluginActive: vi.fn(),
  pluginStorageGet: async (id: string, key: string) => storage.get(`${id}::${key}`) ?? null,
  pluginStorageSet: async (id: string, key: string, v: unknown) => { storage.set(`${id}::${key}`, v); },
}));

vi.mock("@/stores/seededTombstoneStore", () => ({
  loadSeededEntries: async () => new Map([
    ["plain", { id: "plain", version: "1.0.0" }],
    ["widget", { id: "widget", version: "1.0.0" }],
  ]),
}));

import {
  listPlugins, setPluginEnabled, readPluginConfig, writePluginConfig,
  removeSource, updatePlugin, installVettedPlugin, uninstallPlugin,
} from "./plugins";
import { PluginInstallManagedError } from "@/plugins/installErrors";

beforeEach(() => {
  storage.clear();
  vi.clearAllMocks();
  lock.pluginLock.mockReturnValue(null);
  lock.installLocked.mockReturnValue(false);
});

describe("plugin domain", () => {
  it("refuses to uninstall a plugin the organization installs", async () => {
    lock.installLocked.mockReturnValue(true);
    expect(await uninstallPlugin("acme")).toEqual({
      ok: false,
      error: 'plugin "acme" is managed by your organization and cannot be changed',
    });
    expect(marketplace.uninstallPlugin).not.toHaveBeenCalled();
    lock.installLocked.mockReturnValue(false);
    expect((await uninstallPlugin("acme")).ok).toBe(true);
    expect(marketplace.uninstallPlugin).toHaveBeenCalledWith("acme");
  });

  it("lists plugins with origin, hash and available update", async () => {
    const list = await listPlugins();
    const acme = list.find((p) => p.id === "acme")!;
    expect(acme.origin).toBe("catalog");
    expect(acme.hash).toBe("abc");
    expect(acme.updateAvailable).toBe("2.0.0");
    expect(acme.configurable).toEqual(["autoCheck"]);
    expect(list.find((p) => p.id === "plain")!.origin).toBe("seeded");
  });

  it("reports an installed plugin enabled even when its manifest says defaultEnabled:false", async () => {
    registry.isEnabled.mockImplementation(((_id: string, def: boolean) => def) as () => boolean);
    try {
      const list = await listPlugins();
      expect(list.find((p) => p.id === "acme")!.enabled).toBe(true);
      expect(list.find((p) => p.id === "plain")!.enabled).toBe(false);
    } finally {
      registry.isEnabled.mockImplementation(() => true);
    }
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

  it("reports an update for a seeded plugin with no installedMeta entry", async () => {
    const list = await listPlugins();
    const widget = list.find((p) => p.id === "widget")!;
    expect(widget.origin).toBe("seeded");
    expect(widget.updateAvailable).toBe("2.0.0");
  });

  it("refuses an update when the catalog has nothing newer", async () => {
    marketplace.installedMeta = [{ id: "acme", version: "2.0.0", sourceId: "voltius", hash: "abc" }];
    const r = await updatePlugin("acme");
    expect(r.ok).toBe(false);
    marketplace.installedMeta = [{ id: "acme", version: "1.0.0", sourceId: "voltius", hash: "abc" }];
  });

  it("reports a locked plugin and refuses to enable or disable it", async () => {
    lock.pluginLock.mockReturnValue(false);
    expect((await listPlugins()).every((p) => p.locked)).toBe(true);
    const r = await setPluginEnabled("acme", true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("managed by your organization");
    expect(registry.setEnabled).not.toHaveBeenCalled();
  });

  it("does not flag an unlocked plugin", async () => {
    expect((await listPlugins()).some((p) => p.locked)).toBe(false);
  });

  it("installs nothing when the vet refuses the fetched manifest", async () => {
    const vet = vi.fn(() => "no");
    expect(await installVettedPlugin("acme", vet)).toEqual({ ok: false, error: "no" });
    expect(vet).toHaveBeenCalledWith(expect.objectContaining({ id: "acme" }));
    expect(marketplace.installPlugin).not.toHaveBeenCalled();
    expect(marketplace.fetchManifest).toHaveBeenCalledTimes(1);
  });

  it("domain_install_reports_managed", async () => {
    marketplace.installPlugin.mockRejectedValueOnce(new PluginInstallManagedError("widget"));
    const r = await installVettedPlugin("widget", () => null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("managed by your organization");
  });
});
