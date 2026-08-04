import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "./snippetCatalog";
import { bundleFromEntries } from "./snippetCatalogInstall";

const sn = (eid: string, name: string, steps: unknown[] = []) =>
  ({ _eid: eid, name, tags: [], favorite: false, only_for_connection_tags: [], only_for_distros: [], steps }) as never;

const pack: CatalogEntry = {
  id: "docker", kind: "pack", name: "Docker essentials", tags: [],
  snippets: [sn("s0", "A", [{ kind: "snippet", _eid: "s1" }]), sn("s1", "B"), sn("s2", "C")],
};
const single: CatalogEntry = { id: "tail", kind: "snippet", name: "Tail", tags: [], snippets: [sn("s0", "Tail")] };

describe("bundleFromEntries", () => {
  it("puts a pack's snippets in one folder named after the pack", () => {
    const bundle = bundleFromEntries([{ entry: pack }]);

    expect(bundle.folders).toEqual([expect.objectContaining({ name: "Docker essentials", object_type: "snippet" })]);
    expect(bundle.snippets.every(s => s._folder_eid === bundle.folders[0]._eid)).toBe(true);
  });

  it("adds no folder for a standalone snippet entry", () => {
    const bundle = bundleFromEntries([{ entry: single }]);

    expect(bundle.folders).toEqual([]);
    expect(bundle.snippets.map(s => s.name)).toEqual(["Tail"]);
  });

  it("includes only the cherry-picked snippets", () => {
    const bundle = bundleFromEntries([{ entry: pack, snippetEids: ["s2"] }]);

    expect(bundle.snippets.map(s => s.name)).toEqual(["C"]);
  });

  it("pulls in a snippet the picked one calls, so the call is not left broken", () => {
    const bundle = bundleFromEntries([{ entry: pack, snippetEids: ["s0"] }]);

    expect(bundle.snippets.map(s => s.name).sort()).toEqual(["A", "B"]);
    const a = bundle.snippets.find(s => s.name === "A")!;
    const b = bundle.snippets.find(s => s.name === "B")!;
    expect(a.steps).toEqual([{ kind: "snippet", _eid: b._eid }]);
  });

  it("keeps _eids unique when two entries both number their snippets from s0", () => {
    const bundle = bundleFromEntries([{ entry: pack }, { entry: single }]);

    const eids = bundle.snippets.map(s => s._eid);
    expect(new Set(eids).size).toBe(eids.length);
  });
});

// ─── Seam: a built bundle must survive the real import path ──────────────────

describe("bundleFromEntries → runImport", () => {
  it("lands a pack as owned snippets inside a real folder, with the call resolved", async () => {
    const { runImport } = await import("./import-export/registry");
    const created: Record<string, unknown>[] = [];
    let n = 0;
    const ctx = {
      vault_id: "personal", tag: "", skipDupes: false,
      existingConnections: [], existingKeys: [], existingIdentities: [],
      existingSnippets: [], existingPfRules: [],
      folderEidMap: new Map(), snippetFolderEidMap: new Map(), keyEidMap: new Map(),
      identityEidMap: new Map(), connectionEidMap: new Map(),
      stores: {
        saveFolder: async () => ({ id: "folder-main" }),
        saveSnippetFolder: async (d: Record<string, unknown>) => ({ id: "folder-1", ...d }),
        createSnippet: async (d: Record<string, unknown>) => {
          const row = { ...d, id: `new-${n++}` };
          created.push(row);
          return row;
        },
        updateSnippet: async (id: string, d: Record<string, unknown>) => {
          const i = created.findIndex(s => s.id === id);
          created[i] = { ...created[i], ...d };
        },
        saveKey: async () => ({}), saveIdentity: async () => ({}),
        saveConnection: async () => ({}), updateConnection: async () => {},
        createPfRule: async () => ({}),
      },
    } as never;

    await runImport(bundleFromEntries([{ entry: pack }]), ctx);

    expect(created).toHaveLength(3);
    expect(created.every(s => s.folder_id === "folder-1")).toBe(true);
    const a = created.find(s => s.name === "A")!;
    const b = created.find(s => s.name === "B")!;
    expect(a.steps).toEqual([{ kind: "snippet", snippet_id: b.id }]);
  });
});
