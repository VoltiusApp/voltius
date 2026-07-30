import { test, expect } from "vitest";
import { floorPluginFrom, mergeBrowseCatalog, seededActiveIds } from "./floor";
import type { MarketplacePlugin } from "@/stores/marketplaceStore";
import type { SeededEntry } from "@/stores/seededTombstoneStore";
import type { PluginManifest } from "@/plugins/api";

function manifest(over: Partial<PluginManifest> = {}): PluginManifest {
  return { id: "plugin-docker", name: "Docker", version: "1.1.0", description: "Manage containers", permissions: [], ...over };
}

function seeded(over: Partial<PluginManifest> = {}): Map<string, SeededEntry> {
  const m = manifest(over);
  return new Map([[m.id, { folder: "docker", manifest: m }]]);
}

function catalogEntry(over: Partial<MarketplacePlugin> = {}): MarketplacePlugin {
  return {
    id: "plugin-docker", name: "Docker", author: "Voltius", description: "Manage containers",
    repo: "voltiusApp/plugin-docker", version: "1.2.0", tags: [], theme: false, sourceId: "voltius",
    ...over,
  };
}

test("floorPluginFrom marks the entry as builtin with no minAppVersion", () => {
  const p = floorPluginFrom({ folder: "docker", manifest: manifest() });
  expect(p).toMatchObject({ id: "plugin-docker", version: "1.1.0", builtin: true, sourceId: "builtin" });
  expect(p.minAppVersion).toBeUndefined();
});

test("mergeBrowseCatalog prefers the catalogue entry when present and version-satisfied", () => {
  const merged = mergeBrowseCatalog([catalogEntry()], seeded(), ["plugin-docker"], "2.0.0");
  expect(merged).toHaveLength(1);
  expect(merged[0].builtin).toBeUndefined();
  expect(merged[0].version).toBe("1.2.0");
});

test("mergeBrowseCatalog falls back to the floor when the catalogue has no entry", () => {
  const merged = mergeBrowseCatalog([], seeded(), ["plugin-docker"], "2.0.0");
  expect(merged).toHaveLength(1);
  expect(merged[0].builtin).toBe(true);
  expect(merged[0].version).toBe("1.1.0");
});

test("mergeBrowseCatalog falls back to the floor when the catalogue entry's minAppVersion is unsatisfied", () => {
  const merged = mergeBrowseCatalog(
    [catalogEntry({ minAppVersion: "9.9.9" })],
    seeded(),
    ["plugin-docker"],
    "2.0.0",
  );
  expect(merged).toHaveLength(1);
  expect(merged[0].builtin).toBe(true);
});

test("mergeBrowseCatalog treats an unresolved appVersion as satisfying every entry", () => {
  const merged = mergeBrowseCatalog(
    [catalogEntry({ minAppVersion: "9.9.9" })],
    seeded(),
    ["plugin-docker"],
    null,
  );
  expect(merged[0].builtin).toBeUndefined();
});

test("mergeBrowseCatalog adds no floor entry for a built-in that isn't tombstoned", () => {
  const merged = mergeBrowseCatalog([], seeded(), [], "2.0.0");
  expect(merged).toHaveLength(0);
});

test("mergeBrowseCatalog leaves a non-tombstoned built-in's catalogue row untouched", () => {
  const merged = mergeBrowseCatalog([catalogEntry()], seeded(), [], "2.0.0");
  expect(merged).toHaveLength(1);
  expect(merged[0].builtin).toBeUndefined();
});

test("mergeBrowseCatalog passes through unrelated catalogue entries with no seeded counterpart", () => {
  const merged = mergeBrowseCatalog([catalogEntry({ id: "plugin-other" })], new Map(), [], "2.0.0");
  expect(merged).toHaveLength(1);
  expect(merged[0].id).toBe("plugin-other");
});

test("seededActiveIds excludes tombstoned ids and includes active ones", () => {
  const entries = new Map<string, SeededEntry>([
    ["plugin-docker", { folder: "docker", manifest: manifest() }],
    ["plugin-monitoring", { folder: "monitoring", manifest: manifest({ id: "plugin-monitoring" }) }],
  ]);
  const active = seededActiveIds(entries, ["plugin-docker"]);
  expect(active.has("plugin-docker")).toBe(false);
  expect(active.has("plugin-monitoring")).toBe(true);
});
