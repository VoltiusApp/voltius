import { test, expect, vi, beforeEach } from "vitest";

// Dedicated file: no seeded artifact at all exists here (empty plugins_list_seeded),
// which needs its own fixture (see marketplaceStore.supersede.test.ts's cache note).
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

import { useMarketplaceStore, FIRST_PARTY_SOURCE, supersedeStaleFirstPartyShadows } from "./marketplaceStore";
import { useSeededTombstoneStore } from "./seededTombstoneStore";

beforeEach(() => {
  h.invoke.mockClear();
  useMarketplaceStore.setState({ installedMeta: [], installing: new Set() });
  useSeededTombstoneStore.setState({ removed: [] });
  h.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "plugins_list_seeded") return [];
    return undefined;
  });
});

test("no seeded artifact for the id: left alone (nothing to supersede with)", async () => {
  useMarketplaceStore.setState({
    installedMeta: [{ id: "plugin-docker", version: "1.0.0", sourceId: FIRST_PARTY_SOURCE.id, hash: "abc" }],
  });

  await supersedeStaleFirstPartyShadows();

  expect(h.invoke).not.toHaveBeenCalledWith("plugin_delete", { id: "plugin-docker" });
  expect(useMarketplaceStore.getState().installedMeta.find((m) => m.id === "plugin-docker")).toBeDefined();
});
