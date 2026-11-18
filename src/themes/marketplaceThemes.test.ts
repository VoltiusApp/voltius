// @vitest-environment jsdom
import { test, expect } from "vitest";
import type { MarketplacePlugin } from "@/stores/marketplaceStore";
import { availableThemeEntries, isThemeEntry, parsePreview, pluginThemeIdsFor } from "./marketplaceThemes";

function entry(over: Partial<MarketplacePlugin> = {}): MarketplacePlugin {
  return {
    id: "t1", name: "T1", author: "a", description: "d", repo: "r", version: "1.0.0",
    tags: [], theme: true, sourceId: "voltius", ...over,
  };
}

const PALETTE = {
  ui: { bgTerminal: "#141729", accent: "#2d73e0", tabActiveText: "#5fe2f7", statusConnected: "#3fb950" },
  terminal: { background: "#141729", foreground: "#c9d1d9", green: "#3fb950", blue: "#58a6ff", yellow: "#d29922", cyan: "#39c5cf" },
};

test("isThemeEntry accepts the theme flag or the theme tag", () => {
  expect(isThemeEntry(entry({ theme: true, tags: [] }))).toBe(true);
  expect(isThemeEntry(entry({ theme: false, tags: ["theme"] }))).toBe(true);
  expect(isThemeEntry(entry({ theme: false, tags: ["sync"] }))).toBe(false);
});

test("rejects non-hex preview colours", () => {
  expect(parsePreview(PALETTE)).toEqual(PALETTE);
  expect(parsePreview({ ...PALETTE, ui: { ...PALETTE.ui, accent: "url(https://x)" } })).toBeNull();
  const { cyan: _, ...noCyan } = PALETTE.terminal;
  expect(parsePreview({ ...PALETTE, terminal: noCyan })).toBeNull();
  expect(parsePreview(undefined)).toBeNull();
  expect(parsePreview("#fff")).toBeNull();
});

test("parsePreview drops fields outside the palette", () => {
  const parsed = parsePreview({ ...PALETTE, extra: 1, ui: { ...PALETTE.ui, bgCard: "#000" } });
  expect(parsed).toEqual(PALETTE);
});

test("dedupes by id preferring first-party", () => {
  const out = availableThemeEntries(
    [entry({ id: "a", sourceId: "custom" }), entry({ id: "a", sourceId: "voltius" })],
    new Set(),
  );
  expect(out).toHaveLength(1);
  expect(out[0].sourceId).toBe("voltius");
});

test("availableThemeEntries keeps order and drops installed and non-theme entries", () => {
  const out = availableThemeEntries(
    [
      entry({ id: "b", sourceId: "custom" }),
      entry({ id: "plugin", theme: false, tags: ["sync"] }),
      entry({ id: "installed" }),
      entry({ id: "a" }),
      entry({ id: "b", sourceId: "other" }),
    ],
    new Set(["installed"]),
  );
  expect(out.map((p) => [p.id, p.sourceId])).toEqual([["b", "custom"], ["a", "voltius"]]);
});

test("pluginThemeIdsFor matches the plugin id and its namespaced ids only", () => {
  expect(pluginThemeIdsFor(new Map([["x", {}], ["x:dim", {}], ["xy", {}]]), "x")).toEqual(["x", "x:dim"]);
  expect(pluginThemeIdsFor(new Map(), "x")).toEqual([]);
});
