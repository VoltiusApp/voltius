import { test, expect, vi, beforeEach } from "vitest";

// Proves the end-to-end path for Task 3: an ACTIVE built-in (seeded, not tombstoned)
// can receive an out-of-band update through the normal hash-verified network install,
// and the resulting installedMeta entry makes the external copy win on the next boot
// via loadSeededPlugins' existing "external always wins" precedence (seeded.ts).
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

import { useMarketplaceStore, FIRST_PARTY_SOURCE, type MarketplacePlugin } from "./marketplaceStore";
import { useSeededTombstoneStore } from "./seededTombstoneStore";
import { loadSeededPlugins } from "@/plugins/seeded";
import { availableSeededUpdate } from "@/plugins/updates";

const SEEDED_MANIFEST = { id: "plugin-docker", name: "Docker", version: "1.1.0", permissions: ["docker:read"] };

function catalogEntry(over: Partial<MarketplacePlugin> = {}): MarketplacePlugin {
  return {
    id: "plugin-docker", name: "Docker", author: "Voltius", description: "d",
    repo: "voltiusApp/plugin-docker", version: "1.2.0", tags: [], theme: false, sourceId: FIRST_PARTY_SOURCE.id,
    ...over,
  };
}

h.getVersion.mockResolvedValue("2.5.0");

beforeEach(() => {
  h.invoke.mockClear();
  h.loadPlugin.mockClear();
  h.importPluginModule.mockClear();
  useMarketplaceStore.setState({ installedMeta: [], installing: new Set() });
  // Not tombstoned: this built-in is active, exactly the case Task 3 targets.
  useSeededTombstoneStore.setState({ removed: [] });
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, string> = {}) => {
    if (cmd === "plugins_list_seeded") return ["docker"];
    if (cmd === "plugin_seeded_read" && args.id === "docker" && args.filename === "manifest.json") {
      return JSON.stringify(SEEDED_MANIFEST);
    }
    if (cmd === "plugin_seeded_read" && args.id === "docker" && args.filename === "index.js") {
      return "export default () => {}";
    }
    if (cmd === "plugin_seeded_read" && args.id === "docker" && args.filename === "voltius.css") {
      throw new Error("no stylesheet");
    }
    if (cmd === "plugin_fetch_url") {
      return args.url!.endsWith("manifest.json")
        ? JSON.stringify({ id: "plugin-docker", name: "Docker", version: "1.2.0", permissions: ["docker:read", "docker:write"] })
        : "export default () => {}";
    }
    return undefined;
  });
});

test("availableSeededUpdate finds the newer first-party catalogue entry for the active built-in", () => {
  const update = availableSeededUpdate(SEEDED_MANIFEST, [catalogEntry()], "2.5.0");
  expect(update?.version).toBe("1.2.0");
});

test("accepting the update goes through the normal network install, not the floor", async () => {
  const update = availableSeededUpdate(SEEDED_MANIFEST, [catalogEntry()], "2.5.0")!;

  await useMarketplaceStore.getState().installPlugin(update);

  const fetched = h.invoke.mock.calls.filter(([cmd]) => cmd === "plugin_fetch_url");
  expect(fetched.length).toBeGreaterThan(0);
  expect(h.loadPlugin).toHaveBeenCalledOnce();
  const [, , , trusted] = h.loadPlugin.mock.calls[0];
  // Not the seeded floor, so not pre-granted trust — same as any other network install.
  expect(trusted).toBe(false);
});

test("accepting the update writes an installedMeta entry", async () => {
  const update = availableSeededUpdate(SEEDED_MANIFEST, [catalogEntry()], "2.5.0")!;

  await useMarketplaceStore.getState().installPlugin(update);

  const meta = useMarketplaceStore.getState().installedMeta.find((m) => m.id === "plugin-docker");
  expect(meta).toBeDefined();
  expect(meta?.version).toBe("1.2.0");
  expect(meta?.sourceId).toBe(FIRST_PARTY_SOURCE.id);
});

test("after accepting the update, the seeded loader defers to the external copy on the next boot", async () => {
  const update = availableSeededUpdate(SEEDED_MANIFEST, [catalogEntry()], "2.5.0")!;
  await useMarketplaceStore.getState().installPlugin(update);

  h.loadPlugin.mockClear();
  h.invoke.mockClear();
  await loadSeededPlugins();

  // seeded.ts skips any id already present in installedMeta — the external, updated
  // copy wins instead of reloading the (now stale) seeded artifact.
  expect(h.loadPlugin).not.toHaveBeenCalled();
});
