// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import type { PluginManifest } from "@/plugins/api";

const loaded = vi.hoisted(() => ({ list: [] as PluginManifest[] }));
vi.mock("@/plugins/runtime", () => ({ getLoadedPlugins: () => loaded.list, setPluginActive: vi.fn() }));
const i18nMock = vi.hoisted(() => ({ t: (k: string) => k }));
vi.mock("react-i18next", () => ({
  useTranslation: () => i18nMock,
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

test("a policy-locked toggle reads the policy value and is flagged locked", async () => {
  const { usePolicyStore } = await import("@/stores/policyStore");
  usePolicyStore.setState({ machine: { policy: { "appSettings.toggles.cursor-blink": true }, defaults: {} } });
  const item = renderHook(() => useToggleSettings()).result.current.find((i) => i.id === "cursor-blink")!;
  expect(item.locked).toBe(true);
  expect(item.value).toBe(true);
  usePolicyStore.setState({ machine: { policy: {}, defaults: {} } });
});

test("the list is the same array across renders when nothing changed", () => {
  const { result, rerender } = renderHook(() => useToggleSettings());
  const first = result.current;
  rerender();
  expect(result.current).toBe(first);
});
