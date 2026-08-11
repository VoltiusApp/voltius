import { describe, expect, it, vi } from "vitest";
import type { Snippet } from "@/types";
import { snippetsClipboardHalf, type SnippetsClipboardDeps } from "./snippets";

const snippet = (over: Partial<any> = {}) => ({
  id: "s1", name: "one", vault_id: "personal", folder_id: null, steps: [], ...over,
} as unknown as Snippet);

const deps = (over: Partial<any> = {}) => ({
  snippets: [snippet()],
  getSnippetsInFolderTree: () => [],
  vaultForFolder: () => "personal",
  updateSnippet: vi.fn(async () => {}),
  duplicateSnippetInto: vi.fn(async () => ({ id: "copy" })),
  deleteSnippet: vi.fn(async () => {}),
  ...over,
} as SnippetsClipboardDeps);

describe("snippetsClipboardHalf", () => {
  it("reports a folder's kinds only when it holds something", () => {
    expect(snippetsClipboardHalf(deps()).folderContentKinds("f1")).toEqual([]);
    const filled = deps({ getSnippetsInFolderTree: () => [snippet()] });
    expect(snippetsClipboardHalf(filled).folderContentKinds("f1")).toEqual(["snippet"]);
  });

  it("reports a callee left outside the destination vault as dangling", () => {
    const caller = snippet({ id: "s1", steps: [{ kind: "snippet", snippet_id: "s2" }] });
    const callee = snippet({ id: "s2", vault_id: "personal" });
    const half = snippetsClipboardHalf(deps({ snippets: [caller, callee] }));
    expect(half.danglingKinds!([{ id: "s1", kind: "snippet" }], [], "team-1")).toEqual(["snippet"]);
  });

  it("does not report a callee travelling in the same paste", () => {
    const caller = snippet({ id: "s1", steps: [{ kind: "snippet", snippet_id: "s2" }] });
    const callee = snippet({ id: "s2" });
    const half = snippetsClipboardHalf(deps({ snippets: [caller, callee] }));
    const items = [{ id: "s1", kind: "snippet" as const }, { id: "s2", kind: "snippet" as const }];
    expect(half.danglingKinds!(items, [], "team-1")).toEqual([]);
  });

  it("carries vault_id alongside folder_id on a move", async () => {
    const d = deps();
    await snippetsClipboardHalf(d).moveItems(["s1"], "f2", "team-1");
    expect(d.updateSnippet).toHaveBeenCalledWith(
      "s1", expect.objectContaining({ folder_id: "f2", vault_id: "team-1" }),
    );
  });

  it("keeps the snippet's own vault when the destination has none", async () => {
    const d = deps();
    await snippetsClipboardHalf(d).moveItems(["s1"], "f2", null);
    expect(d.updateSnippet).toHaveBeenCalledWith(
      "s1", expect.objectContaining({ vault_id: "personal" }),
    );
  });

  it("returns the ids of the duplicates it created", async () => {
    const half = snippetsClipboardHalf(deps());
    expect(await half.duplicateItems(["s1"], null)).toEqual(["copy"]);
  });
});
