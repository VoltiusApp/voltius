import { test, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/plugins/runtime", () => ({ loadPlugin: vi.fn(), unloadPlugin: vi.fn(), getLoadedPlugins: () => [] }));
vi.mock("@/plugins/importPluginModule", () => ({ importPluginModule: vi.fn(), pluginRegisterOf: vi.fn() }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: vi.fn() }));
vi.mock("@/stores/pluginRegistryStore", () => ({
  usePluginRegistryStore: { getState: () => ({ isEnabled: () => true }) },
  installAllowed: () => true,
}));

import { appFetch } from "@/services/http";
import { useMarketplaceStore, FIRST_PARTY_SOURCE } from "./marketplaceStore";

const THIRD = { id: "third", name: "Third", url: "https://example.com/p.json", enabled: true, deletable: true };
const DOWN = { id: "down", name: "Down", url: "https://down.example/p.json", enabled: true, deletable: true };
const THROWS = { id: "throws", name: "Throws", url: "https://throws.example/p.json", enabled: true, deletable: true };

test("fetchCatalog records which sources failed and keeps the others' entries", async () => {
  useMarketplaceStore.setState({ sources: [FIRST_PARTY_SOURCE, THIRD, DOWN, THROWS], sourceErrors: { stale: "x" } });
  vi.mocked(appFetch).mockImplementation(async (url) => {
    if (url === DOWN.url) return { ok: false, status: 500 } as Response;
    if (url === THROWS.url) throw new Error("offline");
    const id = url === THIRD.url ? "from-third" : "from-first";
    return { ok: true, json: async () => [{ id, name: id, tags: [], theme: true }] } as unknown as Response;
  });

  await useMarketplaceStore.getState().fetchCatalog();

  const s = useMarketplaceStore.getState();
  expect(s.catalog.map((p) => p.id).sort()).toEqual(["from-first", "from-third"]);
  expect(Object.keys(s.sourceErrors).sort()).toEqual(["down", "throws"]);
  expect(s.sourceErrors.down).toBe("HTTP 500");
});
