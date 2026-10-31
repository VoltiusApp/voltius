import { test, expect } from "vitest";
import type { MarketplacePlugin } from "@/stores/marketplaceStore";
import { suggestPlugins, MIXED_RESULTS_PLUGIN_LIMIT } from "./omniPlugins";

const entry = (id: string, extra: Partial<MarketplacePlugin> = {}): MarketplacePlugin =>
  ({ id, name: id, author: "a", description: "", repo: "", version: "1.0.0", tags: [], theme: false, sourceId: "voltius", ...extra });

const ids = (list: MarketplacePlugin[]) => list.map((p) => p.id);
const none = new Set<string>();

test("mixed results stay empty until the query has two characters", () => {
  const catalog = [entry("proxmox")];
  expect(suggestPlugins(catalog, none, null, "", false)).toEqual([]);
  expect(suggestPlugins(catalog, none, null, "p", false)).toEqual([]);
  expect(ids(suggestPlugins(catalog, none, null, "pr", false))).toEqual(["proxmox"]);
});

test("mixed results match name, id and tags but not the description", () => {
  const catalog = [
    entry("plugin-a", { name: "Proxmox" }),
    entry("plugin-b", { tags: ["proxmox"] }),
    entry("plugin-proxmox-extra"),
    entry("plugin-c", { description: "Works great next to Proxmox" }),
  ];
  expect(ids(suggestPlugins(catalog, none, null, "proxmox", false))).toEqual(["plugin-a", "plugin-b", "plugin-proxmox-extra"]);
});

test("mixed results are capped, browsing is not", () => {
  const catalog = Array.from({ length: MIXED_RESULTS_PLUGIN_LIMIT + 2 }, (_, i) => entry(`sync-${i}`));
  expect(suggestPlugins(catalog, none, null, "sync", false)).toHaveLength(MIXED_RESULTS_PLUGIN_LIMIT);
  expect(suggestPlugins(catalog, none, null, "sync", true)).toHaveLength(MIXED_RESULTS_PLUGIN_LIMIT + 2);
});

test("browsing lists everything on an empty query and matches descriptions", () => {
  const catalog = [entry("a", { description: "Docker containers" }), entry("b")];
  expect(ids(suggestPlugins(catalog, none, null, "", true))).toEqual(["a", "b"]);
  expect(ids(suggestPlugins(catalog, none, null, "docker", true))).toEqual(["a"]);
});

test("installed ids, duplicate sources and too-new plugins are left out", () => {
  const catalog = [
    entry("installed"),
    entry("dup", { sourceId: "voltius" }),
    entry("dup", { sourceId: "custom" }),
    entry("future", { minAppVersion: "9.0.0" }),
  ];
  const result = suggestPlugins(catalog, new Set(["installed"]), "1.0.0", "", true);
  expect(result.map((p) => [p.id, p.sourceId])).toEqual([["dup", "voltius"]]);
});
