import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import type { PluginManifest } from "@/plugins/api";

const loaded = vi.hoisted(() => ({ list: [] as PluginManifest[] }));
vi.mock("@/plugins/runtime", () => ({ getLoadedPlugins: () => loaded.list, setPluginActive: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { useToggleSettings } from "./useToggleSettings";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useMarketplaceStore } from "@/stores/marketplaceStore";

const manifest = (id: string, defaultEnabled: boolean): PluginManifest =>
  ({ id, name: id, version: "1.0.0", description: "", permissions: [], defaultEnabled } as PluginManifest);

const pluginValue = (id: string) =>
  renderHook(() => useToggleSettings()).result.current.find((i) => i.id === `plugin:${id}`)!.value;

beforeEach(() => {
  loaded.list = [manifest("installed", false), manifest("bundled", false)];
  usePluginRegistryStore.setState({ overrides: {} });
  useMarketplaceStore.setState({
    installedMeta: [{ id: "installed", version: "1.0.0", sourceId: "voltius", hash: "abc" }],
  });
});
afterEach(cleanup);

test("an installed plugin's quick toggle reads on despite defaultEnabled:false", () => {
  expect(pluginValue("installed")).toBe(true);
});

test("a bundled plugin's quick toggle honours defaultEnabled:false", () => {
  expect(pluginValue("bundled")).toBe(false);
});

test("an explicit override still wins for an installed plugin", () => {
  usePluginRegistryStore.setState({ overrides: { installed: false } });
  expect(pluginValue("installed")).toBe(false);
});
