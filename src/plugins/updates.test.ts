import { test, expect } from "vitest";
import { compareSemver, availableUpdate, addedPermissions } from "./updates";
import type { InstalledPluginMeta, MarketplacePlugin } from "@/stores/marketplaceStore";

// ─── compareSemver ─────────────────────────────────────────────────────────

test("compareSemver orders major/minor/patch", () => {
  expect(compareSemver("1.1.0", "1.0.0")).toBe(1);
  expect(compareSemver("1.0.0", "1.1.0")).toBe(-1);
  expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
  expect(compareSemver("1.0.1", "1.0.0")).toBe(1);
});

test("compareSemver treats equal versions as 0", () => {
  expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
});

test("compareSemver handles unequal segment counts", () => {
  expect(compareSemver("1.2", "1.2.0")).toBe(0);
  expect(compareSemver("1.2.1", "1.2")).toBe(1);
  expect(compareSemver("1", "1.0.1")).toBe(-1);
});

test("compareSemver ignores pre-release/build suffixes (loose)", () => {
  expect(compareSemver("1.2.3-beta", "1.2.3")).toBe(0);
  expect(compareSemver("1.3.0-rc.1", "1.2.0")).toBe(1);
});

// ─── availableUpdate ───────────────────────────────────────────────────────

const plugin = (over: Partial<MarketplacePlugin>): MarketplacePlugin => ({
  id: "p",
  name: "P",
  author: "a",
  description: "",
  repo: "https://example.com/p",
  version: "1.0.0",
  tags: [],
  theme: false,
  sourceId: "voltius",
  ...over,
});

const meta = (over: Partial<InstalledPluginMeta>): InstalledPluginMeta => ({
  id: "p",
  version: "1.0.0",
  sourceId: "voltius",
  hash: null,
  ...over,
});

test("availableUpdate: newer catalog version is an update", () => {
  const got = availableUpdate(meta({ version: "1.0.0" }), [plugin({ version: "1.1.0" })]);
  expect(got?.version).toBe("1.1.0");
});

test("availableUpdate: same version, no hash signal -> no update", () => {
  expect(availableUpdate(meta({ version: "1.0.0" }), [plugin({ version: "1.0.0" })])).toBeNull();
});

test("availableUpdate: same version but differing hashes (both present) -> update", () => {
  const got = availableUpdate(
    meta({ version: "1.0.0", hash: "aaa" }),
    [plugin({ version: "1.0.0", hash: "bbb" })],
  );
  expect(got?.hash).toBe("bbb");
});

test("availableUpdate: same version, same hash -> no update", () => {
  expect(
    availableUpdate(meta({ version: "1.0.0", hash: "aaa" }), [plugin({ version: "1.0.0", hash: "aaa" })]),
  ).toBeNull();
});

test("availableUpdate: null installed hash ignores hash signal", () => {
  expect(
    availableUpdate(meta({ version: "1.0.0", hash: null }), [plugin({ version: "1.0.0", hash: "bbb" })]),
  ).toBeNull();
});

test("availableUpdate: older catalog version is not an update", () => {
  expect(availableUpdate(meta({ version: "2.0.0" }), [plugin({ version: "1.0.0" })])).toBeNull();
});

test("availableUpdate: no matching catalog entry -> null", () => {
  expect(availableUpdate(meta({ id: "p" }), [plugin({ id: "other", version: "9.0.0" })])).toBeNull();
});

test("availableUpdate: matches the entry with the same sourceId, ignoring others", () => {
  const got = availableUpdate(meta({ sourceId: "voltius", version: "1.0.0" }), [
    plugin({ sourceId: "other", version: "5.0.0" }),
    plugin({ sourceId: "voltius", version: "1.1.0" }),
  ]);
  expect(got?.sourceId).toBe("voltius");
  expect(got?.version).toBe("1.1.0");
});

test("availableUpdate: a local plugin is never updated from an id-colliding catalog entry", () => {
  const got = availableUpdate(
    meta({ id: "p", sourceId: "local", version: "1.0.0", hash: null }),
    [plugin({ id: "p", sourceId: "voltius", version: "9.0.0" })],
  );
  expect(got).toBeNull();
});

test("availableUpdate: no entry from the installed source -> null (no cross-source fallback)", () => {
  const got = availableUpdate(
    meta({ sourceId: "voltius", version: "1.0.0" }),
    [plugin({ sourceId: "other", version: "9.0.0" })],
  );
  expect(got).toBeNull();
});

// ─── addedPermissions ──────────────────────────────────────────────────────

test("addedPermissions returns only newly-declared permissions", () => {
  expect(addedPermissions(["themes"], ["themes", "notifications"])).toEqual(["notifications"]);
});

test("addedPermissions is empty when nothing new", () => {
  expect(addedPermissions(["themes", "fs"], ["fs", "themes"])).toEqual([]);
  expect(addedPermissions(["a", "b"], ["a"])).toEqual([]);
});

test("addedPermissions treats all as new against an empty current set", () => {
  expect(addedPermissions([], ["a", "b"])).toEqual(["a", "b"]);
});
