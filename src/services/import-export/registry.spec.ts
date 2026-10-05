// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Connection, Folder, FolderFormData, Identity, PortForwardingRule, Snippet, SshKey } from "@/types";
import type { ExportBundle } from "./formats";
import type { ImportStores, StoreSlices } from "./context";
import { newImportCtx } from "./context";
import { buildBundle, importableFolders, runImport } from "./registry";

const PUB = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKey";
vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(async (key: string) => key.startsWith("password:") ? `pw-${key.slice("password:".length)}` : null),
  storeSecret: vi.fn(async () => {}),
}));
vi.mock("@/services/publicKeyStore", () => ({ ensurePublicKey: vi.fn(async (k: { id: string }) => k.id === "k1" ? `${PUB} me@a` : null) }));

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
    expect(bundle.keyRefs).toEqual([]);
    expect(bundle.connections.every((c) => c._key_eid === undefined)).toBe(true);
  });

  it("exports left-out credentials as refs carrying no secret", async () => {
    const bundle = await buildBundle(onlyConnections, stores, ["personal"], single, () => true);
    expect(bundle.keyRefs).toEqual([{ _eid: "kr0", name: "key", public_key: `${PUB} me@a` }]);
    expect(bundle.identityRefs).toEqual([{ _eid: "ir0", name: "id", username: "u" }]);
    expect(bundle.connections[0]).toMatchObject({ _key_eid: "kr0", _identity_eid: "ir0" });
    expect(bundle.connections[0].jump_hosts![0]._identity_eid).toBe("ir0");
  });

  it("never exports the source vault's key id, with or without the key", async () => {
    for (const includeRelatedCredentials of [false, true]) {
      const bundle = await buildBundle(onlyConnections, stores, ["personal"], single, () => true, { includeRelatedCredentials });
      expect(bundle.connections[0]).not.toHaveProperty("key_id");
      expect(bundle.connections[0]._key_eid).toBeDefined();
    }
  });

  it("writes no key ref when the key has no public half", async () => {
    const noPub = storesOf({ connections: [conn({ id: "c1", key_id: "k2" })], keys: [{ id: "k2", name: "enc", vault_id: "personal", tags: [] } as unknown as SshKey] });
    const bundle = await buildBundle(onlyConnections, noPub, ["personal"], single, () => true);
    expect(bundle.keyRefs).toEqual([]);
    expect(bundle.connections[0]._key_eid).toBeUndefined();
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

  it("keeps empty folders when deduplicating, as the import screen does", async () => {
    const { ctx, saved } = ctxOf(true);
    await runImport(bundle, ctx);
    expect(saved.map((d) => d.name)).toEqual(["Empty", "Child"]);
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
      existingIdentities: [{ id: "have-identity", name: "deploy", username: "root", vault_id: "personal" } as Identity],
      existingSnippets: [{ id: "have-helper", name: "helper", vault_id: "personal" } as Snippet],
      existingPfRules: [], existingFolders: [],
      stores: {
        saveKey: save, saveIdentity: save, saveConnection: save, createSnippet: save,
        updateSnippet: async (_: string, d: Saved) => { saved.set(d.name, d); },
      } as unknown as ImportStores,
    });
    return { ctx, saved };
  }

  it("points kept items at the existing copies of duplicates the user skipped", async () => {
    const { ctx, saved } = ctxOf({ skipped: new Set([key, identity, bastion, helper]) });
    const result = await runImport(bundle, ctx);
    expect(result).toEqual({ imported: 2, errors: 0 });
    expect([...saved.keys()]).toEqual(["caller", "web"]);
    expect(saved.get("web")).toMatchObject({ identity_id: "have-identity", key_id: "have-key" });
    expect(saved.get("web")!.jump_hosts).toMatchObject([{ connection_id: "have-bastion", identity_id: "have-identity" }]);
    expect(saved.get("caller")!.steps).toEqual([{ kind: "snippet", snippet_id: "have-helper" }]);
  });

  it("does the same when deduplicating automatically", async () => {
    const { ctx, saved } = ctxOf({ skipDupes: true });
    await runImport(bundle, ctx);
    expect([...saved.keys()]).toEqual(["caller", "web"]);
    expect(saved.get("web")).toMatchObject({ identity_id: "have-identity", key_id: "have-key" });
    expect(saved.get("web")!.jump_hosts).toMatchObject([{ connection_id: "have-bastion" }]);
    expect(saved.get("caller")!.steps).toEqual([{ kind: "snippet", snippet_id: "have-helper" }]);
  });

  it("imports a duplicate the user kept, pointing references at the new copy", async () => {
    const { ctx, saved } = ctxOf({ skipped: new Set([key, bastion, helper]) });
    await runImport(bundle, ctx);
    expect([...saved.keys()]).toEqual(["deploy", "caller", "web"]);
    expect(saved.get("web")!.identity_id).toBe("new-deploy");
  });

  it("does not take a same-named identity with another username for a duplicate", async () => {
    const other = { ...identity, username: "admin" };
    const { ctx, saved } = ctxOf({ skipDupes: true });
    await runImport({ ...bundle, identities: [other] }, ctx);
    expect(saved.has("deploy")).toBe(true);
  });

  it("matches a connection whose port was exported as a string", async () => {
    const stringPort = { ...bastion, port: "22" };
    const { ctx, saved } = ctxOf({ skipDupes: true });
    await runImport({ ...bundle, connections: [stringPort, web] } as unknown as ExportBundle, ctx);
    expect(saved.has("bastion")).toBe(false);
    expect(saved.get("web")!.jump_hosts).toMatchObject([{ connection_id: "have-bastion" }]);
  });
});

describe("runImport — refs to credentials left out of the export", () => {
  const web = { _eid: "c0", name: "web", host: "web", port: 22, username: "root", auth_type: "key", tags: [], _key_eid: "kr0", _identity_eid: "ir0" };
  const bundleOf = (publicKey: string) => ({
    version: 1, exported_at: "", folders: [], keys: [], identities: [], snippets: [], portForwardingRules: [],
    connections: [web],
    keyRefs: [{ _eid: "kr0", name: "laptop key", public_key: publicKey }],
    identityRefs: [{ _eid: "ir0", name: "deploy", username: "root" }],
  }) as unknown as ExportBundle;

  function ctxOf() {
    const saved: { name: string; key_id?: string; identity_id?: string }[] = [];
    const save = async (d: { name: string }) => { saved.push(d); return { id: `new-${d.name}` }; };
    const ctx = newImportCtx({
      vault_id: "personal", tag: "", skipDupes: false, skipped: new Set(),
      existingConnections: [],
      existingKeys: [{ id: "have-key", name: "Marelis ED25519", vault_id: "personal" } as SshKey],
      existingPublicKeys: new Map([["have-key", `${PUB} other@b`]]),
      existingIdentities: [{ id: "have-identity", name: "deploy", username: "root", vault_id: "personal" } as Identity],
      existingSnippets: [], existingPfRules: [], existingFolders: [],
      stores: { saveKey: save, saveIdentity: save, saveConnection: save } as unknown as ImportStores,
    });
    return { ctx, saved };
  }

  it("links the host to the local key with the same public key, whatever its name", async () => {
    const { ctx, saved } = ctxOf();
    const result = await runImport(bundleOf(`${PUB} me@a`), ctx);
    expect(result).toEqual({ imported: 1, errors: 0 });
    expect(saved).toEqual([expect.objectContaining({ name: "web", key_id: "have-key", identity_id: "have-identity" })]);
  });

  it("creates nothing for a ref the vault has no match for", async () => {
    const { ctx, saved } = ctxOf();
    await runImport(bundleOf("ssh-ed25519 AAAAOtherKey"), ctx);
    expect(saved.map((d) => d.name)).toEqual(["web"]);
    expect(saved[0].key_id).toBeUndefined();
  });
});

describe("runImport — key duplicates compare public keys (#380)", () => {
  const web = { _eid: "c0", name: "web", host: "web", port: 22, username: "root", auth_type: "key", tags: [], _key_eid: "k0" };
  const bundleOf = (public_key: string) => ({
    version: 1, exported_at: "", folders: [], identities: [], snippets: [], portForwardingRules: [],
    keys: [{ _eid: "k0", name: "deploy-key", private_key: "PRIVATE", public_key, tags: [] }],
    connections: [web],
  }) as unknown as ExportBundle;

  function ctxOf() {
    const saved: { name: string; key_id?: string }[] = [];
    const save = async (d: { name: string }) => { saved.push(d); return { id: `new-${d.name}` }; };
    const ctx = newImportCtx({
      vault_id: "personal", tag: "", skipDupes: true,
      existingConnections: [],
      existingKeys: [{ id: "have-key", name: "deploy-key", vault_id: "personal" } as SshKey],
      existingPublicKeys: new Map([["have-key", PUB]]),
      existingIdentities: [], existingSnippets: [], existingPfRules: [], existingFolders: [],
      stores: { saveKey: save, saveConnection: save } as unknown as ImportStores,
    });
    return { ctx, saved };
  }

  it("imports a same-named key with other key material and points the host at it", async () => {
    const { ctx, saved } = ctxOf();
    await runImport(bundleOf("ssh-ed25519 AAAAOtherKey"), ctx);
    expect(saved.map((d) => d.name)).toEqual(["deploy-key", "web"]);
    expect(saved[1].key_id).toBe("new-deploy-key");
  });

  it("skips a same-named key with the same public key and points the host at the existing one", async () => {
    const { ctx, saved } = ctxOf();
    await runImport(bundleOf(`${PUB} comment`), ctx);
    expect(saved.map((d) => d.name)).toEqual(["web"]);
    expect(saved[0].key_id).toBe("have-key");
  });
});

describe("connection pre/post-connect snippets", () => {
  const snippet = (id: string, name: string, steps: unknown[] = []) =>
    ({ id, name, steps, tags: [], only_for_connection_tags: [], only_for_distros: [], vault_id: "personal" }) as unknown as Snippet;

  it("exports the hook snippets and those they call, referenced by eid", async () => {
    const stores = storesOf({
      connections: [conn({ id: "c1", pre_snippet_id: "hook", post_snippet_id: "gone" })],
      snippets: [snippet("hook", "hook", [{ kind: "snippet", snippet_id: "inner" }]), snippet("inner", "inner"), snippet("other", "other")],
    });
    const bundle = await buildBundle(onlyConnections, stores, ["personal"], {}, () => false);
    expect(bundle.snippets.map((s) => s.name)).toEqual(["hook", "inner"]);
    const hook = bundle.snippets.find((s) => s.name === "hook")!;
    expect(bundle.connections[0]._pre_snippet_eid).toBe(hook._eid);
    expect(bundle.connections[0]._post_snippet_eid).toBeUndefined();
    expect(bundle.connections[0]).not.toHaveProperty("pre_snippet_id");
    expect(bundle.connections[0]).not.toHaveProperty("post_snippet_id");
  });

  function importCtx(existingSnippets: Snippet[]) {
    type Saved = { name: string; pre_snippet_id?: string; post_snippet_id?: string; key_id?: string };
    const saved = new Map<string, Saved>();
    const save = async (d: Saved) => { saved.set(d.name, d); return { id: `new-${d.name}` }; };
    const ctx = newImportCtx({
      vault_id: "personal", tag: "", skipDupes: true,
      existingConnections: [], existingKeys: [], existingIdentities: [], existingSnippets, existingPfRules: [], existingFolders: [],
      stores: { saveConnection: save, createSnippet: save } as unknown as ImportStores,
    });
    return { ctx, saved };
  }
  const bundleOf = (web: object, snippets: object[] = [{ _eid: "s0", name: "hook", steps: [], tags: [], only_for_connection_tags: [], only_for_distros: [] }]) => ({
    version: 1, exported_at: "", folders: [], keys: [], identities: [], portForwardingRules: [], snippets, connections: [web],
  }) as unknown as ExportBundle;
  const web = { _eid: "c0", name: "web", host: "web", port: 22, username: "root", auth_type: "password", tags: [] };

  it("points the imported host at the imported hook snippet", async () => {
    const { ctx, saved } = importCtx([]);
    await runImport(bundleOf({ ...web, _pre_snippet_eid: "s0" }), ctx);
    expect(saved.get("web")!.pre_snippet_id).toBe("new-hook");
  });

  it("points it at the vault's own copy when the hook snippet is a skipped duplicate", async () => {
    const { ctx, saved } = importCtx([snippet("have-hook", "hook")]);
    await runImport(bundleOf({ ...web, _post_snippet_eid: "s0" }), ctx);
    expect(saved.has("hook")).toBe(false);
    expect(saved.get("web")!.post_snippet_id).toBe("have-hook");
  });

  it("drops a raw snippet id from an older bundle instead of keeping a dangling reference", async () => {
    const { ctx, saved } = importCtx([]);
    await runImport(bundleOf({ ...web, pre_snippet_id: "stale", key_id: "stale-key" }, []), ctx);
    expect(saved.get("web")).toMatchObject({ pre_snippet_id: undefined, key_id: undefined });
  });
});

describe("buildBundle — per-object secret gate", () => {
  it("exports only what each object's own rules allow", async () => {
    const gate = (o: { id: string }) => o.id !== "locked";
    const stores = storesOf({
      connections: [conn({ id: "locked", name: "locked", vault_id: "t1" }), conn({ id: "open", name: "open", vault_id: "t1" })],
    });
    const bundle = await buildBundle(onlyConnections, stores, ["t1"], {}, gate);
    const byId = Object.fromEntries(bundle.connections.map((c) => [c.name, c]));
    expect(byId.locked.password).toBeUndefined();
    expect(byId.open.password).toBe("pw-open");
  });
});
