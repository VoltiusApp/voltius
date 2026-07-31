import { test, expect, vi, beforeEach, afterEach } from "vitest";

// This file deliberately does NOT mock @/plugins/runtime — installPlugin's
// unload-before-load fix (Fix 4) is only provable against the real registry: a
// mocked unloadPlugin/loadPlugin pair can't show that the OLD code actually stops
// running and the NEW code actually starts. importPluginModule is only partially
// mocked (its exported `injectPluginStyle`/`removePluginStyle` stay real) so real
// stylesheet teardown is exercised too.
const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  importPluginModule: vi.fn(),
  getVersion: vi.fn(async () => "2.5.0"),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: h.getVersion }));
vi.mock("@/plugins/importPluginModule", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/plugins/importPluginModule")>();
  return { ...actual, importPluginModule: h.importPluginModule };
});
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: vi.fn() }));
vi.mock("@/stores/pluginRegistryStore", () => ({
  usePluginRegistryStore: { getState: () => ({ isEnabled: () => true }) },
}));

import { useMarketplaceStore, type MarketplacePlugin } from "./marketplaceStore";
import { getExposedApi, getLoadedPlugins, unloadPlugin } from "@/plugins/runtime";
import { injectPluginStyle } from "@/plugins/importPluginModule";
import { PluginHashMismatchError } from "@/plugins/integrity";
import type { PluginRegisterFn } from "@/plugins/api";

function basePlugin(over: Partial<MarketplacePlugin> = {}): MarketplacePlugin {
  return {
    id: "p1", name: "P1", author: "a", description: "d",
    repo: "https://example.com/p1", version: "1.0.0",
    tags: [], theme: false, sourceId: "voltius", ...over,
  };
}

function manifestFor(version: string): string {
  return JSON.stringify({ id: "p1", name: "P1", version, permissions: [] });
}

/** register() marks which build actually ran, via the exposed-API surface. */
function registerFor(marker: string): PluginRegisterFn {
  return (api) => {
    api.plugins.expose(marker);
    return () => {};
  };
}

/** Mirrors importPluginModule's real side effect (css injection) while letting
 *  the test pick which register() the "bundle" exports, keyed on a marker
 *  baked into the fake js text. */
function mockBundle(marker: string) {
  h.importPluginModule.mockImplementation(async (_jsText: string, css?: string, pluginId?: string) => {
    if (css && pluginId) injectPluginStyle(pluginId, css);
    return { default: registerFor(marker) };
  });
}

function styleTextFor(id: string): string | null {
  return document.getElementById(`voltius-plugin-style-${id}`)?.textContent ?? null;
}

beforeEach(() => {
  h.invoke.mockClear();
  h.importPluginModule.mockClear();
  useMarketplaceStore.setState({ installedMeta: [], installing: new Set() });
});

afterEach(() => {
  try { unloadPlugin("p1"); } catch { /* noop */ }
});

test("installing a second version over an already-loaded plugin unloads the old code so the new code actually runs", async () => {
  mockBundle("v1");
  h.invoke.mockImplementation(async (cmd: string, args: { url?: string }) => {
    if (cmd === "plugin_fetch_url") return args.url!.endsWith("manifest.json") ? manifestFor("1.0.0") : "v1-js";
    return undefined;
  });
  await useMarketplaceStore.getState().installPlugin(basePlugin());
  expect(getExposedApi("p1")).toBe("v1");
  expect(getLoadedPlugins().find((m) => m.id === "p1")?.version).toBe("1.0.0");

  mockBundle("v2");
  h.invoke.mockImplementation(async (cmd: string, args: { url?: string }) => {
    if (cmd === "plugin_fetch_url") return args.url!.endsWith("manifest.json") ? manifestFor("1.1.0") : "v2-js";
    return undefined;
  });
  await useMarketplaceStore.getState().installPlugin(basePlugin({ version: "1.1.0" }));

  // The OLD code must not still be the one running.
  expect(getExposedApi("p1")).toBe("v2");
  expect(getLoadedPlugins().find((m) => m.id === "p1")?.version).toBe("1.1.0");
  expect(getLoadedPlugins().filter((m) => m.id === "p1")).toHaveLength(1);
});

test("an update whose new entry ships no cssHash removes the old injected stylesheet", async () => {
  const { sha256Hex } = await import("@/plugins/integrity");
  const cssHash = await sha256Hex(".old{color:red}");

  mockBundle("v1");
  h.invoke.mockImplementation(async (cmd: string, args: { url?: string }) => {
    if (cmd === "plugin_fetch_url") {
      if (args.url!.endsWith("manifest.json")) return manifestFor("1.0.0");
      if (args.url!.endsWith("voltius.css")) return ".old{color:red}";
      return "v1-js";
    }
    return undefined;
  });
  await useMarketplaceStore.getState().installPlugin(basePlugin({ cssHash }));
  expect(styleTextFor("p1")).toBe(".old{color:red}");

  mockBundle("v2");
  h.invoke.mockImplementation(async (cmd: string, args: { url?: string }) => {
    if (cmd === "plugin_fetch_url") return args.url!.endsWith("manifest.json") ? manifestFor("1.1.0") : "v2-js";
    return undefined; // no cssHash on this update: no CSS fetched
  });
  await useMarketplaceStore.getState().installPlugin(basePlugin({ version: "1.1.0" }));

  expect(styleTextFor("p1")).toBeNull();
  expect(getExposedApi("p1")).toBe("v2");
});

test("a failed update (hash mismatch) leaves the old plugin loaded and working", async () => {
  mockBundle("v1");
  h.invoke.mockImplementation(async (cmd: string, args: { url?: string }) => {
    if (cmd === "plugin_fetch_url") return args.url!.endsWith("manifest.json") ? manifestFor("1.0.0") : "v1-js";
    return undefined;
  });
  await useMarketplaceStore.getState().installPlugin(basePlugin());
  expect(getExposedApi("p1")).toBe("v1");

  mockBundle("v2");
  h.invoke.mockClear();
  h.invoke.mockImplementation(async (cmd: string, args: { url?: string }) => {
    if (cmd === "plugin_fetch_url") return args.url!.endsWith("manifest.json") ? manifestFor("1.1.0") : "v2-js";
    return undefined;
  });

  await expect(
    useMarketplaceStore.getState().installPlugin(basePlugin({ version: "1.1.0", hash: "deadbeef" })),
  ).rejects.toBeInstanceOf(PluginHashMismatchError);

  // The old plugin is untouched: still registered, still the old version, still
  // the old code, no write to disk for the failed candidate.
  expect(getExposedApi("p1")).toBe("v1");
  expect(getLoadedPlugins().find((m) => m.id === "p1")?.version).toBe("1.0.0");
  const wrote = h.invoke.mock.calls.some(([cmd]) => cmd === "plugin_write_file");
  expect(wrote).toBe(false);
});

test("installing a plugin that was never loaded does not call unloadPlugin", async () => {
  mockBundle("v1");
  h.invoke.mockImplementation(async (cmd: string, args: { url?: string }) => {
    if (cmd === "plugin_fetch_url") return args.url!.endsWith("manifest.json") ? manifestFor("1.0.0") : "v1-js";
    return undefined;
  });
  expect(getLoadedPlugins().find((m) => m.id === "p1")).toBeUndefined();

  await useMarketplaceStore.getState().installPlugin(basePlugin());

  expect(getExposedApi("p1")).toBe("v1");
});
