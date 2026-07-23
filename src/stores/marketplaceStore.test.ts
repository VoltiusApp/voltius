import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn(() => "data:text/javascript,export default () => {}"),
  loadPlugin: vi.fn(),
  unloadPlugin: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke, convertFileSrc: h.convertFileSrc }));
vi.mock("@/plugins/runtime", () => ({ loadPlugin: h.loadPlugin, unloadPlugin: h.unloadPlugin }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: vi.fn() }));
vi.mock("@/stores/pluginRegistryStore", () => ({
  usePluginRegistryStore: { getState: () => ({ isEnabled: () => true }) },
}));

import { useMarketplaceStore, type MarketplacePlugin } from "./marketplaceStore";
import { PluginHashMismatchError } from "@/plugins/integrity";

const JS_TEXT = "export default () => {}";
const JS_HASH = "324c9070eb5daa71308b5ca39ce5c17b5274acc6f053df1ca19111d834b79f56";
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
  h.invoke.mockImplementation(async (cmd: string, args: { url?: string }) => {
    if (cmd === "plugin_fetch_url") return args.url!.endsWith("manifest.json") ? MANIFEST : JS_TEXT;
    if (cmd === "plugin_resolve_path") return "/plugins/p1/index.js";
    return undefined; // plugin_write_file etc.
  });
});

test("matching hash installs and records the verified hash", async () => {
  await useMarketplaceStore.getState().installPlugin(basePlugin({ hash: JS_HASH }));
  const meta = useMarketplaceStore.getState().installedMeta.find((m) => m.id === "p1");
  expect(meta?.hash).toBe(JS_HASH);
  expect(h.loadPlugin).toHaveBeenCalledOnce();
});

test("absent hash installs and records hash: null", async () => {
  await useMarketplaceStore.getState().installPlugin(basePlugin());
  const meta = useMarketplaceStore.getState().installedMeta.find((m) => m.id === "p1");
  expect(meta?.hash).toBeNull();
  expect(h.loadPlugin).toHaveBeenCalledOnce();
});

test("mismatched hash throws and writes nothing", async () => {
  await expect(
    useMarketplaceStore.getState().installPlugin(basePlugin({ hash: "deadbeef" })),
  ).rejects.toBeInstanceOf(PluginHashMismatchError);
  expect(h.loadPlugin).not.toHaveBeenCalled();
  const wrote = h.invoke.mock.calls.some(([cmd]) => cmd === "plugin_write_file");
  expect(wrote).toBe(false);
  expect(useMarketplaceStore.getState().installedMeta.find((m) => m.id === "p1")).toBeUndefined();
});
