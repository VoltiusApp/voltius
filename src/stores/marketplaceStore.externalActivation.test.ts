import { test, expect, vi, beforeEach, afterEach } from "vitest";

// Uses the REAL plugin runtime and the REAL pluginRegistryStore: the bug being
// covered is that an externally installed plugin lands inactive, which only shows
// up through api.isActive() gating a real register() — a mocked loadPlugin cannot
// prove it.
const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  getVersion: vi.fn(async () => "2.5.0"),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: h.getVersion }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: vi.fn() }));
vi.mock("@/plugins/importPluginModule", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/plugins/importPluginModule")>();
  return { ...actual, importPluginModule: async () => ({ default: themeRegister }) };
});

import { useMarketplaceStore, loadInstalledPlugins, type MarketplacePlugin } from "./marketplaceStore";
import { usePluginRegistryStore } from "./pluginRegistryStore";
import { usePluginStore } from "./pluginStore";
import { unloadPlugin } from "@/plugins/runtime";
import type { PluginRegisterFn, PluginTheme } from "@/plugins/api";

const PLUGIN_ID = "theme-plugin";
const THEME_ID = "cool-theme";

/** Mirrors the marketplace theme bundles byte for byte in the part that matters:
 *  they open with an isActive() guard, so an inactive plugin registers nothing. */
const themeRegister: PluginRegisterFn = (api) => {
  if (!api.isActive()) return;
  api.themes.register({ id: THEME_ID, name: "Cool Theme" } as PluginTheme);
  return () => api.themes.unregister(THEME_ID);
};

/** A theme manifest as the marketplace actually ships it. */
const MANIFEST = JSON.stringify({
  id: PLUGIN_ID,
  name: "Theme Plugin",
  version: "1.0.0",
  permissions: ["themes"],
  defaultEnabled: false,
});

function themePlugin(): MarketplacePlugin {
  return {
    id: PLUGIN_ID, name: "Theme Plugin", author: "a", description: "d",
    repo: "https://example.com/theme-plugin", version: "1.0.0",
    tags: [], theme: true, sourceId: "voltius",
  };
}

const registeredTheme = () => usePluginStore.getState().pluginThemes.get(THEME_ID);

beforeEach(() => {
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, string> = {}) => {
    if (cmd === "plugin_fetch_url") {
      return args.url!.endsWith("manifest.json") ? MANIFEST : "js-text";
    }
    if (cmd === "plugins_list_installed") return [];
    if (cmd === "plugin_read_file") {
      if (args.filename === "manifest.json") return MANIFEST;
      if (args.filename === "index.js") return "js-text";
      throw new Error("no such file");
    }
    return undefined;
  });
  usePluginRegistryStore.setState({ overrides: {} });
  usePluginStore.setState({ pluginThemes: new Map() });
  useMarketplaceStore.setState({ installedMeta: [], installing: new Set(), catalog: [] });
});

afterEach(() => {
  try { unloadPlugin(PLUGIN_ID); } catch { /* noop */ }
});

test("installing a theme plugin registers its theme even though the manifest sets defaultEnabled false", async () => {
  await useMarketplaceStore.getState().installPlugin(themePlugin());

  expect(registeredTheme()).toBeDefined();
});

test("a theme plugin installed with defaultEnabled false still registers its theme on the next boot", async () => {
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, string> = {}) => {
    if (cmd === "plugins_list_installed") return [PLUGIN_ID];
    if (cmd === "plugin_read_file") {
      if (args.filename === "manifest.json") return MANIFEST;
      if (args.filename === "index.js") return "js-text";
      throw new Error("no such file");
    }
    return undefined;
  });

  await loadInstalledPlugins();

  expect(registeredTheme()).toBeDefined();
});

test("an explicit disable override still keeps an installed plugin inactive", async () => {
  usePluginRegistryStore.setState({ overrides: { [PLUGIN_ID]: false } });

  await useMarketplaceStore.getState().installPlugin(themePlugin());

  expect(registeredTheme()).toBeUndefined();
});

test("reloading a plugin the user disabled does not silently re-enable it", async () => {
  usePluginRegistryStore.setState({ overrides: { [PLUGIN_ID]: false } });
  await useMarketplaceStore.getState().installPlugin(themePlugin());

  await useMarketplaceStore.getState().reloadPlugin(PLUGIN_ID);

  expect(registeredTheme()).toBeUndefined();
});
