import { describe, it, expect } from "vitest";
import { flattenSnippetSteps } from "./snippetFlatten";
import type { Snippet } from "@/types";

function snip(id: string, steps: Snippet["steps"]): Snippet {
  return { id, name: id, steps, tags: [], favorite: false, only_for_connection_tags: [], only_for_distros: [], created_at: "", updated_at: "", vault_id: "personal", clocks: {} };
}

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

  it("reports a missing referenced snippet, keeping siblings", () => {
    const a = snip("A", [
      { kind: "script", content: "a1" },
      { kind: "snippet", snippet_id: "GONE" },
    ]);
    const r = flattenSnippetSteps(a, new Map([["A", a]]));
    expect(r.steps.map((s) => s.kind === "script" && s.content)).toEqual(["a1"]);
    expect(r.errors.some((e) => /missing/i.test(e))).toBe(true);
  });
});
