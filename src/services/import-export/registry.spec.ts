import { describe, expect, it } from "vitest";
import type { Connection, Folder, FolderFormData, Identity, PortForwardingRule, Snippet, SshKey } from "@/types";
import type { ExportBundle } from "./formats";
import type { ImportCtx, ImportStores, StoreSlices } from "./context";
import { buildBundle, runImport } from "./registry";

const conn = (over: Partial<Connection>) =>
  ({ name: "c", host: "h", port: 22, username: "u", tags: [], vault_id: "personal", ...over }) as Connection;

function storesOf(over: Partial<StoreSlices> = {}): StoreSlices {
  return {
    connections: [conn({ id: "c1" })],
    identities: [{ id: "i1", name: "id", username: "u", vault_id: "personal", tags: [] } as unknown as Identity],
    keys: [{ id: "k1", name: "key", vault_id: "personal", tags: [] } as unknown as SshKey],
    folders: [],
    snippets: [{ id: "s1", name: "snip", steps: [], tags: [], only_for_connection_tags: [], only_for_distros: [], vault_id: "personal" } as unknown as Snippet],
    snippetFolders: [],
    pfRules: [{ id: "p1", name: "pf", connection_ids: [], vault_id: "personal" } as unknown as PortForwardingRule],
    ...over,
  };
}

const onlyConnections = { keys: false, identities: false, connections: true, snippets: false, portForwardingRules: false };

describe("buildBundle — INCLUDE selection", () => {
  it("exports only connections when only connections are included", async () => {
    const bundle = await buildBundle(onlyConnections, storesOf(), ["personal"], {}, () => false);
    expect(bundle.connections).toHaveLength(1);
    expect(bundle.identities).toEqual([]);
    expect(bundle.keys).toEqual([]);
    expect(bundle.snippets).toEqual([]);
    expect(bundle.portForwardingRules).toEqual([]);
  });
});

describe("buildBundle — cascade", () => {
  it("pulls in the identity and key a connection uses even when their types are unchecked", async () => {
    const stores = storesOf({ connections: [conn({ id: "c1", identity_id: "i1", key_id: "k1" })] });
    const bundle = await buildBundle(onlyConnections, stores, ["personal"], {}, () => false);
    expect(bundle.identities).toHaveLength(1);
    expect(bundle.keys).toHaveLength(1);
    expect(bundle.connections[0]._identity_eid).toBeDefined();
  });
});

const folder = (over: Partial<Folder>) =>
  ({ name: "f", object_type: "connection", vault_id: "personal", created_at: "", updated_at: "", ...over }) as Folder;

describe("buildBundle — empty folders", () => {
  const stores = storesOf({
    folders: [
      folder({ id: "empty", name: "Empty" }),
      folder({ id: "child", name: "Child", parent_folder_id: "empty" }),
      folder({ id: "keychain", object_type: "keychain" }),
      folder({ id: "gone", deleted_at: "2026-01-01" }),
      folder({ id: "other-vault", vault_id: "team" }),
    ],
    snippetFolders: [folder({ id: "snip", name: "Snips", object_type: "snippet" })],
  });

  it("exports empty folders of each included type in a full export", async () => {
    const bundle = await buildBundle(onlyConnections, stores, ["personal"], {}, () => false);
    expect(bundle.folders.map((f) => f.name).sort()).toEqual(["Child", "Empty"]);
    const child = bundle.folders.find((f) => f.name === "Child")!;
    expect(child.parent_folder_eid).toBe(bundle.folders.find((f) => f.name === "Empty")!._eid);
  });

  it("exports empty snippet folders when snippets are included", async () => {
    const enabled = { ...onlyConnections, connections: false, snippets: true };
    const bundle = await buildBundle(enabled, stores, ["personal"], {}, () => false);
    expect(bundle.folders.map((f) => f.name)).toEqual(["Snips"]);
  });

  it("leaves empty folders out of a selection export", async () => {
    const bundle = await buildBundle(onlyConnections, stores, ["personal"], { single: { key: "connections", id: "c1" } }, () => false);
    expect(bundle.folders).toEqual([]);
  });
});

describe("runImport — empty folders", () => {
  const bundle: ExportBundle = {
    version: 1,
    exported_at: "",
    folders: [
      { _eid: "f0", name: "Empty", object_type: "connection" },
      { _eid: "f1", name: "Child", object_type: "connection", parent_folder_eid: "f0" },
    ],
    connections: [], identities: [], keys: [], snippets: [], portForwardingRules: [],
  };

  function ctxOf(skipDupes: boolean) {
    const saved: FolderFormData[] = [];
    const saveFolder = async (d: FolderFormData) => { saved.push(d); return folder({ id: `id-${d.name}`, name: d.name }); };
    const ctx: ImportCtx = {
      vault_id: "personal", tag: "", skipDupes,
      existingConnections: [], existingKeys: [], existingIdentities: [], existingSnippets: [], existingPfRules: [],
      folderEidMap: new Map(), snippetFolderEidMap: new Map(), keyEidMap: new Map(), identityEidMap: new Map(), connectionEidMap: new Map(),
      stores: { saveFolder, saveSnippetFolder: saveFolder } as unknown as ImportStores,
    };
    return { ctx, saved };
  }

  it("recreates folders no imported item lives in", async () => {
    const { ctx, saved } = ctxOf(false);
    await runImport(bundle, ctx);
    expect(saved.map((d) => [d.name, d.parent_folder_id])).toEqual([["Empty", undefined], ["Child", "id-Empty"]]);
  });

  it("still skips unreferenced folders when deduplicating", async () => {
    const { ctx, saved } = ctxOf(true);
    await runImport(bundle, ctx);
    expect(saved).toEqual([]);
  });
});
