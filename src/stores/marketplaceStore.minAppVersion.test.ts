import { test, expect, vi, beforeEach } from "vitest";

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
import { MinAppVersionError } from "@/plugins/version";

const JS_TEXT = "export default () => {}";
const MANIFEST = JSON.stringify({ id: "p1", name: "P1", version: "1.0.0", permissions: [] });

function basePlugin(over: Partial<MarketplacePlugin> = {}): MarketplacePlugin {
  return {
    id: "p1", name: "P1", author: "a", description: "d",
    repo: "https://example.com/p1", version: "1.0.0",
    tags: [], theme: false, sourceId: "voltius", ...over,
  };
}

// The app version is cached once per module for the whole test process (by design —
// "resolved once lazily"), so this file mocks getVersion to a single fixed value and
// exercises satisfied/unsatisfied via the plugin's minAppVersion instead.
h.getVersion.mockResolvedValue("2.5.0");

beforeEach(() => {
  h.invoke.mockClear();
  h.loadPlugin.mockClear();
  useMarketplaceStore.setState({ installedMeta: [], installing: new Set() });
  h.invoke.mockImplementation(async (cmd: string, args: { url?: string }) => {
    if (cmd === "plugin_fetch_url") return args.url!.endsWith("manifest.json") ? MANIFEST : JS_TEXT;
    return undefined;
  });
});

test("installPlugin proceeds when minAppVersion is satisfied", async () => {
  await useMarketplaceStore.getState().installPlugin(basePlugin({ minAppVersion: "2.0.0" }));
  expect(h.loadPlugin).toHaveBeenCalledOnce();
  expect(useMarketplaceStore.getState().installedMeta.find((m) => m.id === "p1")).toBeTruthy();
});

test("installPlugin proceeds when minAppVersion is absent", async () => {
  await useMarketplaceStore.getState().installPlugin(basePlugin());
  expect(h.loadPlugin).toHaveBeenCalledOnce();
});

test("installPlugin proceeds when minAppVersion is unparseable (fail-open)", async () => {
  await useMarketplaceStore.getState().installPlugin(basePlugin({ minAppVersion: "not-a-version" }));
  expect(h.loadPlugin).toHaveBeenCalledOnce();
});

test("installPlugin refuses an unsatisfied minAppVersion without writing any file", async () => {
  await expect(
    useMarketplaceStore.getState().installPlugin(basePlugin({ minAppVersion: "9.9.9" })),
  ).rejects.toBeInstanceOf(MinAppVersionError);

  expect(h.loadPlugin).not.toHaveBeenCalled();
  const wrote = h.invoke.mock.calls.some(([cmd]) => cmd === "plugin_write_file");
  expect(wrote).toBe(false);
  expect(useMarketplaceStore.getState().installedMeta.find((m) => m.id === "p1")).toBeUndefined();
});

test("installPlugin's MinAppVersionError carries the required and actual versions", async () => {
  try {
    await useMarketplaceStore.getState().installPlugin(basePlugin({ minAppVersion: "9.9.9" }));
    throw new Error("expected installPlugin to reject");
  } catch (e) {
    expect(e).toBeInstanceOf(MinAppVersionError);
    expect((e as MinAppVersionError).required).toBe("9.9.9");
    expect((e as MinAppVersionError).actual).toBe("2.5.0");
  }
});

test("loadAppVersion caches the resolved version in the store", async () => {
  await useMarketplaceStore.getState().loadAppVersion();
  expect(useMarketplaceStore.getState().appVersion).toBe("2.5.0");
});
