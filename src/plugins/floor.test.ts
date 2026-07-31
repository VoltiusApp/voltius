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

test("mergeBrowseCatalog emits at most one row per id when two sources both list the same unsatisfied built-in", () => {
  const merged = mergeBrowseCatalog(
    [
      catalogEntry({ minAppVersion: "9.9.9", sourceId: "voltius" }),
      catalogEntry({ minAppVersion: "9.9.9", sourceId: "other-source" }),
    ],
    seeded(),
    ["plugin-docker"],
    "2.0.0",
  );
  expect(merged).toHaveLength(1);
  expect(merged[0].builtin).toBe(true);
});

test("mergeBrowseCatalog emits at most one row per id when two sources both list the same ACTIVE (non-tombstoned) built-in", () => {
  const merged = mergeBrowseCatalog(
    [
      catalogEntry({ sourceId: "voltius" }),
      catalogEntry({ sourceId: "other-source" }),
    ],
    seeded(),
    [], // not tombstoned — plugin-docker is active
    "2.0.0",
  );
  expect(merged).toHaveLength(1);
  expect(merged[0].sourceId).toBe("voltius");
});

test("mergeBrowseCatalog falls back to the floor when the catalogue version is older than the seeded manifest", () => {
  const merged = mergeBrowseCatalog([catalogEntry({ version: "1.0.0" })], seeded(), ["plugin-docker"], "2.0.0");
  expect(merged).toHaveLength(1);
  expect(merged[0].builtin).toBe(true);
  expect(merged[0].version).toBe("1.1.0");
});

test("mergeBrowseCatalog falls back to the floor when the catalogue version ties the seeded manifest", () => {
  const merged = mergeBrowseCatalog([catalogEntry({ version: "1.1.0" })], seeded(), ["plugin-docker"], "2.0.0");
  expect(merged).toHaveLength(1);
  expect(merged[0].builtin).toBe(true);
  expect(merged[0].version).toBe("1.1.0");
});

test("mergeBrowseCatalog falls back to the floor when the catalogue version is unparseable", () => {
  const merged = mergeBrowseCatalog([catalogEntry({ version: "not-a-version" })], seeded(), ["plugin-docker"], "2.0.0");
  expect(merged).toHaveLength(1);
  expect(merged[0].builtin).toBe(true);
});

test("mergeBrowseCatalog does not throw and falls back to the floor for a catalogue entry with a missing version", () => {
  const entry = catalogEntry() as Partial<MarketplacePlugin>;
  delete entry.version;
  const merged = mergeBrowseCatalog([entry as MarketplacePlugin], seeded(), ["plugin-docker"], "2.0.0");
  expect(merged).toHaveLength(1);
  expect(merged[0].builtin).toBe(true);
});

test("mergeBrowseCatalog does not throw and falls back to the floor for a non-string catalogue version", () => {
  for (const badVersion of [null, 3, {}, []] as unknown[]) {
    const merged = mergeBrowseCatalog(
      [catalogEntry({ version: badVersion as unknown as string })],
      seeded(),
      ["plugin-docker"],
      "2.0.0",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].builtin).toBe(true);
  }
});

test("mergeBrowseCatalog falls back to the floor when the seeded manifest's version is unparseable, even against a valid newer catalogue version", () => {
  const merged = mergeBrowseCatalog(
    [catalogEntry({ version: "1.0.0" })],
    seeded({ version: "garbage" }),
    ["plugin-docker"],
    "2.0.0",
  );
  expect(merged).toHaveLength(1);
  expect(merged[0].builtin).toBe(true);
});

test("mergeBrowseCatalog falls back to the floor for a newer catalogue version whose minAppVersion is unsatisfied", () => {
  const merged = mergeBrowseCatalog(
    [catalogEntry({ version: "1.2.0", minAppVersion: "9.9.9" })],
    seeded(),
    ["plugin-docker"],
    "2.0.0",
  );
  expect(merged).toHaveLength(1);
  expect(merged[0].builtin).toBe(true);
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
