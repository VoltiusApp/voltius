import { describe, expect, it } from "vitest";
import type { SnippetStep } from "@/types";
import { SnippetRefError, stepsFromExport, stepsToExport } from "./snippetRefs";
import type { SnippetStepExport } from "./snippetRefs";

describe("stepsToExport", () => {
  it("rewrites a nested snippet call to the target's _eid", () => {
    const steps: SnippetStep[] = [
      { kind: "script", content: "echo hi" },
      { kind: "snippet", snippet_id: "id-b" },
    ];

    const result = stepsToExport(steps, new Map([["id-b", "s3"]]), "A");

    expect(result).toEqual([
      { kind: "script", content: "echo hi" },
      { kind: "snippet", _eid: "s3" },
    ]);
  });

  it("throws naming the snippet and its missing target when the call leaves the bundle", () => {
    const steps: SnippetStep[] = [{ kind: "snippet", snippet_id: "id-gone" }];

    expect(() => stepsToExport(steps, new Map(), "Deploy")).toThrow(SnippetRefError);
    expect(() => stepsToExport(steps, new Map(), "Deploy")).toThrow(/Deploy.*id-gone/);
  });
});

describe("stepsFromExport", () => {
  it("resolves a nested call's _eid to the newly created local id", () => {
    const steps: SnippetStepExport[] = [
      { kind: "script", content: "echo hi" },
      { kind: "snippet", _eid: "s3" },
    ];

    const result = stepsFromExport(steps, new Map([["s3", "new-id-b"]]), "A");

    expect(result).toEqual([
      { kind: "script", content: "echo hi" },
      { kind: "snippet", snippet_id: "new-id-b" },
    ]);
  });

  it("throws when an _eid resolves to nothing", () => {
    const steps: SnippetStepExport[] = [{ kind: "snippet", _eid: "s9" }];

    expect(() => stepsFromExport(steps, new Map(), "Deploy")).toThrow(SnippetRefError);
  });

  it("throws on a legacy raw snippet_id rather than importing a dangling call", () => {
    const steps = [{ kind: "snippet", snippet_id: "id-from-another-machine" }] as unknown as SnippetStepExport[];

    expect(() => stepsFromExport(steps, new Map(), "Legacy")).toThrow(SnippetRefError);
  });
});
