import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  loadPlugin: vi.fn(),
  unloadPlugin: vi.fn(),
  importPluginModule: vi.fn(async () => ({ default: () => {} })),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
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

// ─── Source persistence ───────────────────────────────────────────────────

const SOURCES_FILE = "marketplace-sources.json";

function sourceWrites() {
  return h.invoke.mock.calls
    .filter(([cmd, args]) => cmd === "plugin_write_file" && (args as { filename: string }).filename === SOURCES_FILE)
    .map(([, args]) => JSON.parse((args as { content: string }).content));
}

function resetSources() {
  useMarketplaceStore.setState({ sources: [FIRST_PARTY_SOURCE_FIXTURE] });
}

const FIRST_PARTY_SOURCE_FIXTURE = {
  id: "voltius",
  name: "Voltius Marketplace",
  url: "https://raw.githubusercontent.com/voltiusApp/marketplace/main/plugins.json",
  enabled: true,
  deletable: false,
};

test("addSource persists the new source", async () => {
  resetSources();
  const { appFetch } = await import("@/services/http");
  vi.mocked(appFetch).mockResolvedValue({
    ok: true, json: async () => ({ id: "third", name: "Third Party" }),
  } as Response);

  await useMarketplaceStore.getState().addSource("https://example.com/plugins.json");

  const writes = sourceWrites();
  expect(writes.length).toBe(1);
  expect(writes[0].custom).toEqual([
    { id: "third", name: "Third Party", url: "https://example.com/plugins.json", enabled: true, deletable: true },
  ]);
});

test("removeSource persists the removal", async () => {
  resetSources();
  useMarketplaceStore.setState({
    sources: [FIRST_PARTY_SOURCE_FIXTURE,
      { id: "third", name: "Third", url: "https://example.com/p.json", enabled: true, deletable: true }],
  });

  await useMarketplaceStore.getState().removeSource("third");

  const w = sourceWrites();
  expect(w[w.length - 1].custom).toEqual([]);
});

test("toggleSource persists the enabled flag, including for the built-in source", async () => {
  resetSources();
  await useMarketplaceStore.getState().toggleSource("voltius");

  expect(useMarketplaceStore.getState().sources[0].enabled).toBe(false);
  const w = sourceWrites();
  expect(w[w.length - 1].enabled).toEqual({ voltius: false });
});

test("loadSources restores custom sources and enabled overrides across a restart", async () => {
  resetSources();
  h.invoke.mockImplementation(async (cmd: string, args: { filename?: string }) => {
    if (cmd === "plugin_read_file" && args.filename === SOURCES_FILE) {
      return JSON.stringify({
        custom: [{ id: "third", name: "Third", url: "https://example.com/p.json", enabled: true, deletable: true }],
        enabled: { voltius: false, third: true },
      });
    }
    throw new Error("not found");
  });

  await useMarketplaceStore.getState().loadSources();

  const sources = useMarketplaceStore.getState().sources;
  expect(sources.map((s) => s.id)).toEqual(["voltius", "third"]);
  expect(sources[0].enabled).toBe(false);
  expect(sources[0].deletable).toBe(false);
  expect(sources[1].enabled).toBe(true);
});

test("loadSources on a fresh profile leaves just the built-in source", async () => {
  resetSources();
  h.invoke.mockImplementation(async () => { throw new Error("not found"); });

  await useMarketplaceStore.getState().loadSources();

  expect(useMarketplaceStore.getState().sources).toEqual([FIRST_PARTY_SOURCE_FIXTURE]);
});

test("loadSources never resurrects a custom source as non-deletable", async () => {
  resetSources();
  h.invoke.mockImplementation(async (cmd: string, args: { filename?: string }) => {
    if (cmd === "plugin_read_file" && args.filename === SOURCES_FILE) {
      return JSON.stringify({
        custom: [{ id: "voltius", name: "Impostor", url: "https://evil.example/p.json", enabled: true, deletable: false }],
        enabled: {},
      });
    }
    throw new Error("not found");
  });

  await useMarketplaceStore.getState().loadSources();

  const sources = useMarketplaceStore.getState().sources;
  expect(sources.length).toBe(1);
  expect(sources[0].url).toBe(FIRST_PARTY_SOURCE_FIXTURE.url);
});
