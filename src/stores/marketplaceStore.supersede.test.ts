import { test, expect, vi, beforeEach } from "vitest";

// Task 4: closes the trap Task 3 opens. seeded.ts's "external always wins" precedence
// has no version check, so once a user takes an out-of-band update, a LATER app
// release shipping a newer built-in would stay shadowed by the older external copy
// forever. supersedeStaleFirstPartyShadows() removes a stale first-party-sourced
// external copy before loadSeededPlugins() runs, so the seeded artifact loads instead.
//
// Kept to one seeded fixture (folder "docker" @ 2.0.0) for the whole file: the
// seeded-manifest-id cache in seededTombstoneStore.ts is module-scoped and persists
// across tests within a file (see marketplaceStore.restoreFloor.test.ts). Cases that
// need a different seeded manifest (malformed version, no seeded artifact) live in
// their own dedicated files instead of mutating the mock mid-file.
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

import {
  useMarketplaceStore, FIRST_PARTY_SOURCE, supersedeStaleFirstPartyShadows,
  type InstalledPluginMeta,
} from "./marketplaceStore";
import { useSeededTombstoneStore } from "./seededTombstoneStore";
import { loadSeededPlugins } from "@/plugins/seeded";

// Seeded artifacts ship at 2.0.0 in this "app release". Two entries from the start
// (not added later) — the seeded-manifest cache is primed on the file's first call
// and never changes afterwards, so any id a later test needs must be here already.
const SEEDED_MANIFEST = { id: "plugin-docker", name: "Docker", version: "2.0.0", permissions: ["docker:read"] };
const SEEDED_MANIFEST_2 = { id: "plugin-docker-2", name: "Docker 2", version: "2.0.0", permissions: [] };

function seedInvokeMock() {
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, string> = {}) => {
    if (cmd === "plugins_list_seeded") return ["docker", "docker2"];
    if (cmd === "plugin_seeded_read" && args.id === "docker" && args.filename === "manifest.json") {
      return JSON.stringify(SEEDED_MANIFEST);
    }
    if (cmd === "plugin_seeded_read" && args.id === "docker2" && args.filename === "manifest.json") {
      return JSON.stringify(SEEDED_MANIFEST_2);
    }
    if (cmd === "plugin_seeded_read" && args.id === "docker" && args.filename === "index.js") {
      return "export default () => {}";
    }
    if (cmd === "plugin_seeded_read" && args.id === "docker" && args.filename === "voltius.css") {
      throw new Error("no stylesheet");
    }
    if (cmd === "plugin_delete") return undefined;
    if (cmd === "plugin_write_file") return undefined;
    return undefined;
  });
}

beforeEach(() => {
  h.invoke.mockClear();
  h.loadPlugin.mockClear();
  h.importPluginModule.mockClear();
  useMarketplaceStore.setState({ installedMeta: [], installing: new Set() });
  useSeededTombstoneStore.setState({ removed: [] });
  seedInvokeMock();
});

test("seeded newer than a first-party external: external removed, seeded loads with trusted=true", async () => {
  useMarketplaceStore.setState({
    installedMeta: [{ id: "plugin-docker", version: "1.5.0", sourceId: FIRST_PARTY_SOURCE.id, hash: "abc" }],
  });

  await supersedeStaleFirstPartyShadows();

  expect(h.invoke).toHaveBeenCalledWith("plugin_delete", { id: "plugin-docker" });
  expect(useMarketplaceStore.getState().installedMeta.find((m) => m.id === "plugin-docker")).toBeUndefined();

  h.loadPlugin.mockClear();
  await loadSeededPlugins();
  // "docker2"'s always-seeded id also loads in this fixture — filter to the id under test.
  const call = h.loadPlugin.mock.calls.find(([manifest]) => manifest.id === "plugin-docker");
  expect(call).toBeDefined();
  const [, , , trusted] = call!;
  expect(trusted).toBe(true);
});

test("seeded version equal to a first-party external: seeded wins (Ruling 4)", async () => {
  useMarketplaceStore.setState({
    installedMeta: [{ id: "plugin-docker", version: "2.0.0", sourceId: FIRST_PARTY_SOURCE.id, hash: "abc" }],
  });

  await supersedeStaleFirstPartyShadows();

  expect(h.invoke).toHaveBeenCalledWith("plugin_delete", { id: "plugin-docker" });
  expect(useMarketplaceStore.getState().installedMeta.find((m) => m.id === "plugin-docker")).toBeUndefined();
});

test("seeded older than a first-party external: external kept, seeded stays skipped", async () => {
  useMarketplaceStore.setState({
    installedMeta: [{ id: "plugin-docker", version: "2.5.0", sourceId: FIRST_PARTY_SOURCE.id, hash: "abc" }],
  });

  await supersedeStaleFirstPartyShadows();

  expect(h.invoke).not.toHaveBeenCalledWith("plugin_delete", { id: "plugin-docker" });
  const meta = useMarketplaceStore.getState().installedMeta.find((m) => m.id === "plugin-docker");
  expect(meta?.version).toBe("2.5.0");

  h.loadPlugin.mockClear();
  await loadSeededPlugins();
  // seeded.ts still defers to the (still present, still newer) external copy for
  // this id specifically ("docker2" also loads in this fixture, unrelated to it).
  expect(h.loadPlugin.mock.calls.some(([manifest]) => manifest.id === "plugin-docker")).toBe(false);
});

test("third-party-sourced install sharing the id is never superseded, regardless of version", async () => {
  useMarketplaceStore.setState({
    installedMeta: [{ id: "plugin-docker", version: "1.0.0", sourceId: "some-third-party-source", hash: "abc" }],
  });

  await supersedeStaleFirstPartyShadows();

  expect(h.invoke).not.toHaveBeenCalledWith("plugin_delete", { id: "plugin-docker" });
  expect(useMarketplaceStore.getState().installedMeta.find((m) => m.id === "plugin-docker")?.version).toBe("1.0.0");
});

test("tombstoned id is never resurrected by this path", async () => {
  useSeededTombstoneStore.setState({ removed: ["plugin-docker"] });
  useMarketplaceStore.setState({
    installedMeta: [{ id: "plugin-docker", version: "1.0.0", sourceId: FIRST_PARTY_SOURCE.id, hash: "abc" }],
  });

  await supersedeStaleFirstPartyShadows();

  // Left alone: no delete, no meta change — a tombstoned built-in must stay uninstalled.
  expect(h.invoke).not.toHaveBeenCalledWith("plugin_delete", { id: "plugin-docker" });
  expect(useMarketplaceStore.getState().installedMeta.find((m) => m.id === "plugin-docker")?.version).toBe("1.0.0");
});

test("malformed external version: left alone rather than defaulting to supersede", async () => {
  useMarketplaceStore.setState({
    installedMeta: [{ id: "plugin-docker", version: "not-a-version", sourceId: FIRST_PARTY_SOURCE.id, hash: "abc" }],
  });

  await supersedeStaleFirstPartyShadows();

  expect(h.invoke).not.toHaveBeenCalledWith("plugin_delete", { id: "plugin-docker" });
  expect(useMarketplaceStore.getState().installedMeta.find((m) => m.id === "plugin-docker")).toBeDefined();
});

test("missing external version (undefined): left alone", async () => {
  useMarketplaceStore.setState({
    installedMeta: [
      { id: "plugin-docker", version: undefined, sourceId: FIRST_PARTY_SOURCE.id, hash: "abc" } as unknown as InstalledPluginMeta,
    ],
  });

  await supersedeStaleFirstPartyShadows();

  expect(h.invoke).not.toHaveBeenCalledWith("plugin_delete", { id: "plugin-docker" });
  expect(useMarketplaceStore.getState().installedMeta.find((m) => m.id === "plugin-docker")).toBeDefined();
});

test("non-string external version (number): left alone", async () => {
  useMarketplaceStore.setState({
    installedMeta: [
      { id: "plugin-docker", version: 3, sourceId: FIRST_PARTY_SOURCE.id, hash: "abc" } as unknown as InstalledPluginMeta,
    ],
  });

  await supersedeStaleFirstPartyShadows();

  expect(h.invoke).not.toHaveBeenCalledWith("plugin_delete", { id: "plugin-docker" });
  expect(useMarketplaceStore.getState().installedMeta.find((m) => m.id === "plugin-docker")).toBeDefined();
});

test("missing sourceId: left alone (a legacy entry is never treated as first-party)", async () => {
  useMarketplaceStore.setState({
    installedMeta: [
      { id: "plugin-docker", version: "1.0.0", hash: "abc" } as unknown as InstalledPluginMeta,
    ],
  });

  await supersedeStaleFirstPartyShadows();

  expect(h.invoke).not.toHaveBeenCalledWith("plugin_delete", { id: "plugin-docker" });
  expect(useMarketplaceStore.getState().installedMeta.find((m) => m.id === "plugin-docker")).toBeDefined();
});

test("partial failure: the second of two qualifying entries fails to delete, only it survives", async () => {
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, string> = {}) => {
    if (cmd === "plugins_list_seeded") return ["docker", "docker2"];
    if (cmd === "plugin_seeded_read" && args.id === "docker" && args.filename === "manifest.json") {
      return JSON.stringify(SEEDED_MANIFEST);
    }
    if (cmd === "plugin_seeded_read" && args.id === "docker2" && args.filename === "manifest.json") {
      return JSON.stringify(SEEDED_MANIFEST_2);
    }
    if (cmd === "plugin_delete" && args.id === "plugin-docker") return undefined;
    if (cmd === "plugin_delete" && args.id === "plugin-docker-2") throw new Error("locked file");
    if (cmd === "plugin_write_file") return undefined;
    return undefined;
  });
  useMarketplaceStore.setState({
    installedMeta: [
      { id: "plugin-docker", version: "1.0.0", sourceId: FIRST_PARTY_SOURCE.id, hash: "abc" },
      { id: "plugin-docker-2", version: "1.0.0", sourceId: FIRST_PARTY_SOURCE.id, hash: "def" },
    ],
  });

  await supersedeStaleFirstPartyShadows();

  expect(h.invoke).toHaveBeenCalledWith("plugin_delete", { id: "plugin-docker" });
  expect(h.invoke).toHaveBeenCalledWith("plugin_delete", { id: "plugin-docker-2" });
  const ids = useMarketplaceStore.getState().installedMeta.map((m) => m.id);
  expect(ids).toEqual(["plugin-docker-2"]);
});

test("a failed installedMeta write does not throw, so plugin boot can still proceed", async () => {
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, string> = {}) => {
    if (cmd === "plugins_list_seeded") return ["docker", "docker2"];
    if (cmd === "plugin_seeded_read" && args.id === "docker" && args.filename === "manifest.json") {
      return JSON.stringify(SEEDED_MANIFEST);
    }
    if (cmd === "plugin_delete") return undefined;
    if (cmd === "plugin_write_file") throw new Error("disk full");
    return undefined;
  });
  useMarketplaceStore.setState({
    installedMeta: [{ id: "plugin-docker", version: "1.0.0", sourceId: FIRST_PARTY_SOURCE.id, hash: "abc" }],
  });

  await expect(supersedeStaleFirstPartyShadows()).resolves.toBeUndefined();
  // Files were deleted (best effort) even though the meta write failed.
  expect(h.invoke).toHaveBeenCalledWith("plugin_delete", { id: "plugin-docker" });
});

