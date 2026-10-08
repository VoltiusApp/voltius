// @vitest-environment jsdom
import { beforeAll, describe, it, expect } from "vitest";
import { flattenSnippetSteps } from "./snippetFlatten";
import i18n, { ensureLocale } from "@/i18n";
import type { Snippet } from "@/types";

function snip(id: string, steps: Snippet["steps"]): Snippet {
  return { id, name: id, steps, tags: [], favorite: false, only_for_connection_tags: [], only_for_distros: [], created_at: "", updated_at: "", vault_id: "personal", clocks: {} };
}

describe("flattenSnippetSteps — localization", () => {
  beforeAll(() => ensureLocale("fr"));

  it("localizes the cycle error under the fr locale", () => {
    i18n.changeLanguage("fr");
    try {
      const a = snip("A", [{ kind: "snippet", snippet_id: "A" }]);
      const r = flattenSnippetSteps(a, new Map([["A", a]]));
      expect(r.errors[0]).toContain("détecté");
      expect(r.errors[0]).toContain("A");
    } finally {
      i18n.changeLanguage("en");
    }
  });

  it("localizes the missing-reference error under the fr locale", () => {
    i18n.changeLanguage("fr");
    try {
      const a = snip("A", [{ kind: "snippet", snippet_id: "GONE" }]);
      const r = flattenSnippetSteps(a, new Map([["A", a]]));
      expect(r.errors[0]).toContain("introuvable");
    } finally {
      i18n.changeLanguage("en");
    }
  });
});

describe("flattenSnippetSteps", () => {
  it("expands snippet-call steps inline, preserving order", () => {
    const b = snip("B", [{ kind: "script", content: "b1" }]);
    const a = snip("A", [
      { kind: "script", content: "a1" },
      { kind: "snippet", snippet_id: "B" },
      { kind: "script", content: "a2" },
    ]);
    const r = flattenSnippetSteps(a, new Map([["A", a], ["B", b]]));
    expect(r.steps.map((s) => s.kind === "script" && s.content)).toEqual(["a1", "b1", "a2"]);
    expect(r.errors).toEqual([]);
  });

  it("detects a direct self cycle without hanging", () => {
    const a = snip("A", [{ kind: "snippet", snippet_id: "A" }]);
    const r = flattenSnippetSteps(a, new Map([["A", a]]));
    expect(r.steps).toEqual([]);
    expect(r.errors.some((e) => /cycle/i.test(e))).toBe(true);
  });

  it("detects an A→B→A cycle", () => {
    const a = snip("A", [{ kind: "snippet", snippet_id: "B" }]);
    const b = snip("B", [{ kind: "snippet", snippet_id: "A" }]);
    const r = flattenSnippetSteps(a, new Map([["A", a], ["B", b]]));
    expect(r.errors.some((e) => /cycle/i.test(e))).toBe(true);
  });

  it("stops at the max nesting depth on a deep non-cyclic chain", () => {
    // s0 → s1 → … → s60, all distinct (no cycle), so only the depth backstop
    // can halt expansion.
    const map = new Map<string, Snippet>();
    const N = 60;
    for (let i = 0; i <= N; i++) {
      const next: Snippet["steps"] = i < N
        ? [{ kind: "snippet", snippet_id: `s${i + 1}` }]
        : [{ kind: "script", content: "leaf" }];
      map.set(`s${i}`, snip(`s${i}`, next));
    }
    const r = flattenSnippetSteps(map.get("s0")!, map);
    expect(r.errors.some((e) => /too deep|profonde/i.test(e))).toBe(true);
    // The backstop fires before the deepest script is ever reached.
    expect(r.steps).toEqual([]);
  });

  it("reports a missing referenced snippet, keeping siblings", () => {
    const a = snip("A", [
      { kind: "script", content: "a1" },
      { kind: "snippet", snippet_id: "GONE" },
    ]);
    const r = flattenSnippetSteps(a, new Map([["A", a]]));
    expect(r.steps.map((s) => s.kind === "script" && s.content)).toEqual(["a1"]);
    expect(r.errors.some((e) => /missing/i.test(e))).toBe(true);
  });

  it("caps combinatorial diamond-DAG expansion instead of blowing up", () => {
    // Each level fans out to the next twice → 2^depth leaves without a cap.
    const depth = 12;
    const map = new Map<string, Snippet>();
    for (let i = 0; i < depth; i++) {
      map.set(`n${i}`, snip(`n${i}`, [
        { kind: "snippet", snippet_id: `n${i + 1}` },
        { kind: "snippet", snippet_id: `n${i + 1}` },
      ]));
    }
    map.set(`n${depth}`, snip(`n${depth}`, [{ kind: "script", content: "leaf" }]));
    const r = flattenSnippetSteps(map.get("n0")!, map);
    expect(r.steps.length).toBeLessThanOrEqual(1000);
    expect(r.errors.some((e) => /too many steps/i.test(e))).toBe(true);
  });
});
