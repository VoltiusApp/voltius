import { describe, expect, it } from "vitest";
import type { Snippet, SnippetFormData } from "@/types";
import type { ExportBundle, SnippetExport } from "../formats";
import type { ImportCtx } from "../context";
import { snippetsHandler } from "./snippets";

function snippetExport(over: Partial<SnippetExport> & { _eid: string; name: string }): SnippetExport {
  return { tags: [], favorite: false, only_for_connection_tags: [], only_for_distros: [], ...over };
}

function bundleOf(snippets: SnippetExport[]): ExportBundle {
  return {
    version: 1, exported_at: "2026-08-04T00:00:00Z",
    folders: [], connections: [], identities: [], keys: [], portForwardingRules: [],
    snippets,
  };
}

/** An in-memory stand-in for the snippet store, so the handler's real logic runs. */
function fakeCtx(over: Partial<ImportCtx> = {}) {
  const created: Snippet[] = [];
  let n = 0;
  const ctx = {
    vault_id: "personal", tag: "", skipDupes: false,
    existingConnections: [], existingKeys: [], existingIdentities: [],
    existingSnippets: [], existingPfRules: [],
    folderEidMap: new Map(), snippetFolderEidMap: new Map(), keyEidMap: new Map(),
    identityEidMap: new Map(), connectionEidMap: new Map(),
    stores: {
      createSnippet: async (data: SnippetFormData) => {
        const s = { ...data, id: `new-${n++}`, vault_id: data.vault_id ?? "personal" } as Snippet;
        created.push(s);
        return s;
      },
      updateSnippet: async (id: string, data: SnippetFormData) => {
        const i = created.findIndex((s) => s.id === id);
        created[i] = { ...created[i], ...data };
      },
    },
    ...over,
  } as unknown as ImportCtx;
  return { ctx, created };
}

describe("snippetsHandler.importItems — nested calls", () => {
  it("points an imported nested call at the newly created target, not the exported _eid", async () => {
    const { ctx, created } = fakeCtx();
    const bundle = bundleOf([
      snippetExport({ _eid: "s0", name: "A", steps: [{ kind: "snippet", _eid: "s1" } as never] }),
      snippetExport({ _eid: "s1", name: "B", steps: [{ kind: "script", content: "echo b" }] }),
    ]);

    const result = await snippetsHandler.importItems(bundle, ctx);

    const a = created.find((s) => s.name === "A")!;
    const b = created.find((s) => s.name === "B")!;
    expect(a.steps).toEqual([{ kind: "snippet", snippet_id: b.id }]);
    expect(result).toEqual({ imported: 2, errors: 0 });
  });

  it("resolves a cycle between two snippets in the same bundle", async () => {
    const { ctx, created } = fakeCtx();
    const bundle = bundleOf([
      snippetExport({ _eid: "s0", name: "A", steps: [{ kind: "snippet", _eid: "s1" } as never] }),
      snippetExport({ _eid: "s1", name: "B", steps: [{ kind: "snippet", _eid: "s0" } as never] }),
    ]);

    await snippetsHandler.importItems(bundle, ctx);

    const a = created.find((s) => s.name === "A")!;
    const b = created.find((s) => s.name === "B")!;
    expect(a.steps).toEqual([{ kind: "snippet", snippet_id: b.id }]);
    expect(b.steps).toEqual([{ kind: "snippet", snippet_id: a.id }]);
  });

  it("counts an error and creates nothing for a snippet whose call is missing from the bundle", async () => {
    const { ctx, created } = fakeCtx();
    const bundle = bundleOf([
      snippetExport({ _eid: "s0", name: "Broken", steps: [{ kind: "snippet", _eid: "gone" } as never] }),
      snippetExport({ _eid: "s1", name: "Fine", steps: [{ kind: "script", content: "ok" }] }),
    ]);

    const result = await snippetsHandler.importItems(bundle, ctx);

    expect(created.map((s) => s.name)).toEqual(["Fine"]);
    expect(result).toEqual({ imported: 1, errors: 1 });
  });

  it("resolves a call to a target skipped as a duplicate against the existing snippet", async () => {
    const existing = { id: "old-b", name: "B", vault_id: "personal" } as Snippet;
    const { ctx, created } = fakeCtx({ skipDupes: true, existingSnippets: [existing] });
    const bundle = bundleOf([
      snippetExport({ _eid: "s0", name: "A", steps: [{ kind: "snippet", _eid: "s1" } as never] }),
      snippetExport({ _eid: "s1", name: "B", steps: [{ kind: "script", content: "echo b" }] }),
    ]);

    const result = await snippetsHandler.importItems(bundle, ctx);

    expect(created.map((s) => s.name)).toEqual(["A"]);
    expect(created[0].steps).toEqual([{ kind: "snippet", snippet_id: "old-b" }]);
    expect(result).toEqual({ imported: 1, errors: 0 });
  });
});

function localSnippet(over: Partial<Snippet> & { id: string; name: string }): Snippet {
  return {
    steps: [], tags: [], favorite: false, only_for_connection_tags: [], only_for_distros: [],
    created_at: "", updated_at: "", vault_id: "personal", clocks: {}, ...over,
  };
}

const exportCtx = { snippetFolderEidMap: new Map() } as never;

describe("snippetsHandler.buildExports — nested calls", () => {
  it("rewrites a nested call to the target's _eid instead of a machine-local id", async () => {
    const items = [
      localSnippet({ id: "id-a", name: "A", steps: [{ kind: "snippet", snippet_id: "id-b" }] }),
      localSnippet({ id: "id-b", name: "B", steps: [{ kind: "script", content: "echo b" }] }),
    ];
    const bundle = bundleOf([]);

    await snippetsHandler.buildExports(items, exportCtx, bundle);

    expect(bundle.snippets[0].steps).toEqual([{ kind: "snippet", _eid: bundle.snippets[1]._eid }]);
  });

  it("refuses to export a call whose target is outside the selection", async () => {
    const items = [localSnippet({ id: "id-a", name: "A", steps: [{ kind: "snippet", snippet_id: "id-elsewhere" }] })];

    await expect(snippetsHandler.buildExports(items, exportCtx, bundleOf([])))
      .rejects.toThrow(/A.*id-elsewhere/);
  });
});
