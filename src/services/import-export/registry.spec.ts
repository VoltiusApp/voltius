import { describe, expect, it } from "vitest";
import type { Connection, Folder, FolderFormData, Identity, PortForwardingRule, Snippet, SshKey } from "@/types";
import type { ExportBundle } from "./formats";
import type { ImportStores, StoreSlices } from "./context";
import { newImportCtx } from "./context";
import { buildBundle, importableFolders, runImport } from "./registry";

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

describe("buildBundle — related credentials", () => {
  const stores = storesOf({
    connections: [conn({ id: "c1", identity_id: "i1", key_id: "k1", jump_hosts: [{ id: "j", connection_id: "c2", host: "", port: 22, username: "" }] }), conn({ id: "c2", identity_id: "i1" })],
  });
  const single = { single: { key: "connections", id: "c1" } };

  it("pulls in the identity and key a connection uses when asked to", async () => {
    const bundle = await buildBundle(onlyConnections, stores, ["personal"], single, () => false, { includeRelatedCredentials: true });
    expect(bundle.identities).toHaveLength(1);
    expect(bundle.keys).toHaveLength(1);
    expect(bundle.connections[0]._identity_eid).toBeDefined();
  });

  it("leaves unchecked identities and keys out by default, still following jump hosts", async () => {
    const bundle = await buildBundle(onlyConnections, stores, ["personal"], single, () => false);
    expect(bundle.identities).toEqual([]);
    expect(bundle.keys).toEqual([]);
    expect(bundle.connections).toHaveLength(2);
    expect(bundle.connections.every((c) => c._identity_eid === undefined && c._key_eid === undefined)).toBe(true);
  });

  it("keeps identity references when identities are checked", async () => {
    const bundle = await buildBundle({ ...onlyConnections, identities: true }, stores, ["personal"], {}, () => false);
    expect(bundle.identities).toHaveLength(1);
    expect(bundle.keys).toEqual([]);
    expect(bundle.connections[0]._identity_eid).toBe(bundle.identities[0]._eid);
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

  function ctxOf(skipDupes: boolean, existingFolders: Folder[] = []) {
    const saved: FolderFormData[] = [];
    const saveFolder = async (d: FolderFormData) => { saved.push(d); return folder({ id: `id-${d.name}`, name: d.name }); };
    const ctx = newImportCtx({
      vault_id: "personal", tag: "", skipDupes,
      existingConnections: [], existingKeys: [], existingIdentities: [], existingSnippets: [], existingPfRules: [], existingFolders,
      stores: { saveFolder, saveSnippetFolder: saveFolder } as unknown as ImportStores,
    });
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

  it("reuses a matching folder the vault already has instead of duplicating it", async () => {
    // The backend sends root folders with a null parent, not a missing one.
    const existing = [folder({ id: "have-empty", name: "Empty", parent_folder_id: null as unknown as undefined }), folder({ id: "have-child", name: "Child", parent_folder_id: "have-empty" })];
    const { ctx, saved } = ctxOf(false, existing);
    const result = await runImport(bundle, ctx);
    expect(saved).toEqual([]);
    expect(result.imported).toBe(0);
    expect(ctx.folderEidMap.get("f1")).toBe("have-child");
  });

  it("puts an imported item into the existing folder it matches", async () => {
    const existing = [folder({ id: "have-empty", name: "Empty", parent_folder_id: null as unknown as undefined })];
    const { ctx, saved } = ctxOf(false, existing);
    const conns: { folder_id?: string }[] = [];
    ctx.stores.saveConnection = async (d) => { conns.push(d); return conn({ id: "c-new", ...d } as Partial<Connection>); };
    const withHost = { ...bundle, connections: [{ _eid: "c0", name: "h", host: "h", port: 22, username: "u", auth_type: "password", tags: [], _folder_eid: "f0" }] } as unknown as ExportBundle;
    await runImport(withHost, ctx);
    expect(saved.map((d) => d.name)).toEqual(["Child"]);
    expect(conns.map((c) => c.folder_id)).toEqual(["have-empty"]);
  });

  it("does not reuse a same-named folder under a different parent or of another type", async () => {
    const existing = [folder({ id: "have-empty", name: "Empty", object_type: "keychain" }), folder({ id: "have-child", name: "Child" })];
    const { ctx, saved } = ctxOf(false, existing);
    await runImport(bundle, ctx);
    expect(saved.map((d) => d.name)).toEqual(["Empty", "Child"]);
  });
});

describe("importableFolders", () => {
  const conn = (eid: string, folderEid: string) => ({ _eid: eid, name: eid, host: "h", port: 22, username: "u", _folder_eid: folderEid }) as unknown as ExportBundle["connections"][number];
  const original: ExportBundle = {
    version: 1,
    exported_at: "",
    folders: [
      { _eid: "prod", name: "Prod", object_type: "connection" },
      { _eid: "eu", name: "EU", object_type: "connection", parent_folder_eid: "prod" },
      { _eid: "dev", name: "Dev", object_type: "connection" },
      { _eid: "lab", name: "Lab", object_type: "connection" },
      { _eid: "empty", name: "Empty", object_type: "connection" },
    ],
    connections: [conn("c1", "prod"), conn("c2", "dev"), conn("c3", "lab")],
    identities: [], keys: [], snippets: [], portForwardingRules: [],
  };
  const eids = (kept: string[]) =>
    importableFolders(original, new Set(original.connections.filter((c) => !kept.includes(c._eid!)))).map((f) => f._eid);

  it("drops folders whose every item was skipped, keeping empty ones and their ancestors", () => {
    expect(eids([])).toEqual(["prod", "eu", "empty"]);
  });

  it("keeps the folders of items still being imported", () => {
    expect(eids(["c3"])).toEqual(["prod", "eu", "lab", "empty"]);
  });
});

describe("runImport — references to skipped duplicates", () => {
  const key = { _eid: "k0", name: "deploy-key", tags: [] };
  const identity = { _eid: "i0", name: "deploy", username: "root", tags: [], _key_eid: "k0" };
  const bastion = { _eid: "c0", name: "bastion", host: "bastion", port: 22, username: "root", auth_type: "password", tags: [] };
  const web = {
    _eid: "c1", name: "web", host: "web", port: 22, username: "root", auth_type: "key", tags: [],
    _identity_eid: "i0", _key_eid: "k0",
    jump_hosts: [{ id: "j", host: "bastion", port: 22, username: "root", _connection_eid: "c0", _identity_eid: "i0" }],
  };
  const helper = { _eid: "s0", name: "helper", steps: [{ kind: "script", content: "echo" }], tags: [], only_for_connection_tags: [], only_for_distros: [] };
  const caller = { _eid: "s1", name: "caller", steps: [{ kind: "snippet", _eid: "s0" }], tags: [], only_for_connection_tags: [], only_for_distros: [] };
  const bundle = {
    version: 1, exported_at: "", folders: [],
    keys: [key], identities: [identity], connections: [bastion, web], snippets: [helper, caller], portForwardingRules: [],
  } as unknown as ExportBundle;

  type Saved = { name: string; identity_id?: string; key_id?: string; steps?: unknown[]; jump_hosts?: { connection_id: string; identity_id?: string }[] };

  function ctxOf(opts: { skipDupes?: boolean; skipped?: Set<object> }) {
    const saved = new Map<string, Saved>();
    const save = async (d: Saved) => { saved.set(d.name, d); return { id: `new-${d.name}` }; };
    const ctx = newImportCtx({
      vault_id: "personal", tag: "", skipDupes: opts.skipDupes ?? false, skipped: opts.skipped,
      existingConnections: [conn({ id: "have-bastion", host: "bastion", username: "root" })],
      existingKeys: [{ id: "have-key", name: "deploy-key", vault_id: "personal" } as SshKey],
      existingIdentities: [{ id: "have-identity", name: "deploy", vault_id: "personal" } as Identity],
      existingSnippets: [{ id: "have-helper", name: "helper", vault_id: "personal" } as Snippet],
      existingPfRules: [], existingFolders: [],
      stores: {
        saveKey: save, saveIdentity: save, saveConnection: save, createSnippet: save,
        updateSnippet: async (_: string, d: Saved) => { saved.set(d.name, d); },
        updateConnection: async () => { throw new Error("a skipped connection must stay where it is"); },
      } as unknown as ImportStores,
    });
    return { ctx, saved };
  }

  it("points kept items at the existing copies of duplicates the user skipped", async () => {
    const { ctx, saved } = ctxOf({ skipped: new Set([key, identity, bastion, helper]) });
    const result = await runImport(bundle, ctx);
    expect(result).toEqual({ imported: 2, errors: 0 });
    expect([...saved.keys()]).toEqual(["web", "caller"]);
    expect(saved.get("web")).toMatchObject({ identity_id: "have-identity", key_id: "have-key" });
    expect(saved.get("web")!.jump_hosts).toMatchObject([{ connection_id: "have-bastion", identity_id: "have-identity" }]);
    expect(saved.get("caller")!.steps).toEqual([{ kind: "snippet", snippet_id: "have-helper" }]);
  });

  it("does the same when deduplicating automatically", async () => {
    const { ctx, saved } = ctxOf({ skipDupes: true });
    await runImport(bundle, ctx);
    expect([...saved.keys()]).toEqual(["web", "caller"]);
    expect(saved.get("web")).toMatchObject({ identity_id: "have-identity", key_id: "have-key" });
    expect(saved.get("web")!.jump_hosts).toMatchObject([{ connection_id: "have-bastion" }]);
    expect(saved.get("caller")!.steps).toEqual([{ kind: "snippet", snippet_id: "have-helper" }]);
  });

  it("imports a duplicate the user kept, pointing references at the new copy", async () => {
    const { ctx, saved } = ctxOf({ skipped: new Set([key, bastion, helper]) });
    await runImport(bundle, ctx);
    expect([...saved.keys()]).toEqual(["deploy", "web", "caller"]);
    expect(saved.get("web")!.identity_id).toBe("new-deploy");
  });
});
