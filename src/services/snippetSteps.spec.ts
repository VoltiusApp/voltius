import { describe, it, expect } from "vitest";
import { snippetScriptText, snippetSearchText, stepsFromLegacy, normalizeSnippetSteps } from "./snippetSteps";
import type { Snippet } from "@/types";

function mk(steps: Snippet["steps"]): Snippet {
  return { id: "1", name: "n", steps, tags: [], favorite: false, only_for_connection_tags: [], only_for_distros: [], created_at: "", updated_at: "", vault_id: "personal", clocks: {} };
}

describe("snippetSteps", () => {
  it("stepsFromLegacy wraps content", () => {
    expect(stepsFromLegacy("echo hi")).toEqual([{ kind: "script", content: "echo hi" }]);
  });

  it("normalizeSnippetSteps derives steps from legacy content", () => {
    const out = normalizeSnippetSteps({ content: "x" });
    expect(out.steps).toEqual([{ kind: "script", content: "x" }]);
  });

  it("snippetScriptText joins script steps only", () => {
    const s = mk([
      { kind: "script", content: "a" },
      { kind: "transfer", direction: "upload", local_path: "/l", remote_path: "/r", is_dir: false },
      { kind: "script", content: "b" },
    ]);
    expect(snippetScriptText(s)).toBe("a\nb");
  });

  it("snippetSearchText includes transfer paths", () => {
    const s = mk([{ kind: "transfer", direction: "download", local_path: "/logs", remote_path: "/var/log/app", is_dir: true }]);
    expect(snippetSearchText(s)).toContain("/var/log/app");
    expect(snippetSearchText(s)).toContain("/logs");
  });
});
