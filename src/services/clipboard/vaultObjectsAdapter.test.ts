// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection, Folder, Identity, PortForwardingRule, Snippet, SshKey } from "@/types";
import type { VaultObjectPorts } from "@/services/vaultObjectWrites";
import { pasteFromClipboard } from "@/services/vaultClipboard";
import { moveWithSecrets } from "@/services/vaultObjectSecrets";
import { createPasteState, headlessVaultObjectsAdapter, type PasteState, type VaultObjectTab } from "./vaultObjectsAdapter";

vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(async () => "material"),
  storeSecret: vi.fn(async () => {}),
}));
vi.mock("@/services/vaultObjectSecrets", () => ({
  moveWithSecrets: vi.fn(async (_k: string, _o: unknown, _t: string, update: () => Promise<unknown>) => {
    await update();
  }),
}));

const conn = (id: string, over: Partial<Connection> = {}): Connection =>
  ({ id, name: id, host: `${id}.example`, port: 22, username: "root", tags: [], vault_id: "personal", ...over }) as Connection;
const key = (id: string, over: Partial<SshKey> = {}): SshKey =>
  ({ id, name: id, key_type: "ed25519", tags: [], vault_id: "personal", ...over }) as SshKey;
const identity = (id: string, over: Partial<Identity> = {}): Identity =>
  ({ id, name: id, username: "u", tags: [], vault_id: "personal", ...over }) as Identity;
const snippet = (id: string, over: Partial<Snippet> = {}): Snippet =>
  ({ id, name: id, steps: [], tags: [], vault_id: "personal", ...over }) as Snippet;
const rule = (id: string, over: Partial<PortForwardingRule> = {}): PortForwardingRule =>
  ({ id, name: id, connection_ids: [], vault_id: "personal", ...over }) as PortForwardingRule;
const folder = (id: string, over: Partial<Folder> = {}): Folder =>
  ({ id, name: id, object_type: "connection", vault_id: "personal", ...over }) as Folder;
const jump = (connection_id: string) => ({ id: `j-${connection_id}`, connection_id });

interface World {
  connections: Connection[];
  keys: SshKey[];
  identities: Identity[];
  snippets: Snippet[];
  rules: PortForwardingRule[];
  folders: Folder[];
  snippetFolders: Folder[];
}

/** In-memory stores: a save appends `<id>-copy`, an update merges the form in. */
function memoryPorts(seed: Partial<World>) {
  const w: World = { connections: [], keys: [], identities: [], snippets: [], rules: [], folders: [], snippetFolders: [], ...seed };
  const save = <T extends { id: string }>(list: () => T[], set: (v: T[]) => void) => vi.fn(async (form: object) => {
    const source = (form as { name?: string }).name ?? "obj";
    const created = { ...form, id: `${source}-${list().length}` } as unknown as T;
    set([...list(), created]);
    return created;
  });
  const update = <T extends { id: string }>(list: () => T[], set: (v: T[]) => void) => vi.fn(async (id: string, form: object) => {
    set(list().map((o) => (o.id === id ? { ...o, ...form } : o)));
  });
  const ports = {
    connections: () => w.connections,
    keys: () => w.keys,
    identities: () => w.identities,
    snippets: () => w.snippets,
    rules: () => w.rules,
    folders: () => w.folders,
    snippetFolders: () => w.snippetFolders,
    saveConnection: save(() => w.connections, (v) => { w.connections = v; }),
    updateConnection: update(() => w.connections, (v) => { w.connections = v; }),
    deleteConnection: vi.fn(async () => {}),
    loadConnections: vi.fn(async () => {}),
    saveKey: save(() => w.keys, (v) => { w.keys = v; }),
    updateKey: update(() => w.keys, (v) => { w.keys = v; }),
    deleteKey: vi.fn(async () => {}),
    loadKeys: vi.fn(async () => {}),
    saveIdentity: save(() => w.identities, (v) => { w.identities = v; }),
    updateIdentity: update(() => w.identities, (v) => { w.identities = v; }),
    deleteIdentity: vi.fn(async () => {}),
    loadIdentities: vi.fn(async () => {}),
    createSnippet: save(() => w.snippets, (v) => { w.snippets = v; }),
    updateSnippet: update(() => w.snippets, (v) => { w.snippets = v; }),
    deleteSnippet: vi.fn(async () => {}),
    createRule: save(() => w.rules, (v) => { w.rules = v; }),
    updateRule: update(() => w.rules, (v) => { w.rules = v; }),
    deleteRule: vi.fn(async () => {}),
    moveRuleFolder: vi.fn(async () => {}),
    moveObjectsToFolder: vi.fn(async () => {}),
    saveFolder: save(() => w.folders, (v) => { w.folders = v; }),
    updateFolder: update(() => w.folders, (v) => { w.folders = v; }),
    deleteFolder: vi.fn(async () => {}),
    moveFolder: vi.fn(async () => {}),
    saveSnippetFolder: save(() => w.snippetFolders, (v) => { w.snippetFolders = v; }),
    updateSnippetFolder: update(() => w.snippetFolders, (v) => { w.snippetFolders = v; }),
    deleteSnippetFolder: vi.fn(async () => {}),
    moveSnippetFolder: vi.fn(async () => {}),
  } satisfies VaultObjectPorts;
  return { w, ports };
}

const adapterFor = (
  tab: VaultObjectTab,
  ports: VaultObjectPorts,
  target: { folderId?: string | null; vaultId: string | null },
  state?: PasteState,
) =>
  headlessVaultObjectsAdapter({
    tab, ports, can: () => true, folderId: target.folderId ?? null, vaultId: target.vaultId,
    accessibleVaultIds: ["personal", "team"], state,
  });

const paste = (adapter: ReturnType<typeof adapterFor>, mode: "copy" | "cut", items: { id: string; kind: "connection" | "key" | "identity" | "snippet" | "port_forward" }[], folderIds: string[] = []) =>
  pasteFromClipboard({ tab: adapter.navItem, mode, items, folderIds, sourceVaultIds: [] }, adapter);

describe("vaultObjectsAdapter", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("plans the jump host, its key and the startup snippet a host needs in the destination", () => {
    const { ports } = memoryPorts({
      connections: [conn("a", { jump_hosts: [jump("b")], pre_snippet_id: "s" }), conn("b", { key_id: "k" })],
      keys: [key("k")],
      snippets: [snippet("s")],
    });
    const adapter = adapterFor("hosts", ports, { vaultId: "team" });
    const items = [{ id: "a", kind: "connection" as const }];
    expect(adapter.danglingKinds!(items, [], "team").sort()).toEqual(["connection", "key", "snippet"]);
    expect(adapter.planCascade!(items, [], "team", "cut").map((e) => `${e.type}:${e.label}:${e.action}`))
      .toEqual(["connection:b:move", "key:k:move", "snippet:s:move"]);
  });

  it("moves a host with its jump host into the destination, keeping the jump link", async () => {
    const { w, ports } = memoryPorts({
      connections: [conn("a", { jump_hosts: [jump("b")] }), conn("b", { folder_id: "old-folder" })],
    });
    await paste(adapterFor("hosts", ports, { vaultId: "team" }), "cut", [{ id: "a", kind: "connection" }]);
    expect(w.connections.map((c) => [c.id, c.vault_id, c.folder_id])).toEqual([
      ["a", "team", undefined], ["b", "team", undefined],
    ]);
    expect(w.connections[0].jump_hosts?.[0].connection_id).toBe("b");
    expect(moveWithSecrets).toHaveBeenCalledTimes(2);
  });

  it("points a moved host at the copy of a jump host other hosts still use", async () => {
    const { w, ports } = memoryPorts({
      connections: [conn("a", { jump_hosts: [jump("b")] }), conn("b"), conn("other", { jump_hosts: [jump("b")] })],
    });
    await paste(adapterFor("hosts", ports, { vaultId: "team" }), "cut", [{ id: "a", kind: "connection" }]);
    const copy = w.connections.find((c) => c.id !== "b" && c.name === "b")!;
    expect(copy.vault_id).toBe("team");
    expect(w.connections.find((c) => c.id === "a")!.jump_hosts![0].connection_id).toBe(copy.id);
    expect(w.connections.find((c) => c.id === "b")!.vault_id).toBe("personal");
  });

  it("points a copied host at the copy of its jump host pasted alongside, whatever the order", async () => {
    const { w, ports } = memoryPorts({
      connections: [conn("a", { jump_hosts: [jump("b")] }), conn("b")],
    });
    await paste(adapterFor("hosts", ports, { vaultId: "team" }), "copy", [
      { id: "a", kind: "connection" }, { id: "b", kind: "connection" },
    ]);
    const copyA = w.connections.find((c) => c.vault_id === "team" && c.name === "a")!;
    const copyB = w.connections.find((c) => c.vault_id === "team" && c.name === "b")!;
    expect(copyA.jump_hosts![0].connection_id).toBe(copyB.id);
  });

  it("moves objects as they stand outside a paste, so an undo never relinks through a later paste's copies", async () => {
    const { w, ports } = memoryPorts({
      connections: [conn("a", { key_id: "k" }), conn("h", { key_id: "k", vault_id: "team" })],
      keys: [key("k", { vault_id: "team" })],
    });
    const state = createPasteState();
    await paste(adapterFor("hosts", ports, { vaultId: "team" }, state), "cut", [{ id: "a", kind: "connection" }]);
    const toPersonal = adapterFor("hosts", ports, { vaultId: "personal" }, state);
    await paste(toPersonal, "copy", [{ id: "h", kind: "connection" }]);
    expect(w.keys.some((k) => k.vault_id === "personal")).toBe(true);

    await toPersonal.moveItems(["a"], null, "personal");
    expect(w.connections.find((c) => c.id === "a")).toMatchObject({ vault_id: "personal", key_id: "k" });
  });

  it("reparents and reloads on a same-vault move", async () => {
    const { ports } = memoryPorts({ connections: [conn("a")], folders: [folder("f")] });
    await paste(adapterFor("hosts", ports, { folderId: "f", vaultId: null }), "cut", [{ id: "a", kind: "connection" }]);
    expect(ports.moveObjectsToFolder).toHaveBeenCalledWith(["a"], "connection", "f");
    expect(ports.loadConnections).toHaveBeenCalled();
  });

  it("copies a folder subtree into the destination with its contents filed under the clones", async () => {
    const { w, ports } = memoryPorts({
      folders: [folder("root"), folder("child", { parent_folder_id: "root" })],
      connections: [conn("a", { folder_id: "child" })],
    });
    await paste(adapterFor("hosts", ports, { vaultId: "team" }), "copy", [], ["root"]);
    const clonedChild = w.folders.find((f) => f.name === "child" && f.vault_id === "team")!;
    expect(w.connections.find((c) => c.vault_id === "team")!.folder_id).toBe(clonedChild.id);
  });

  it("carries a moved folder's contents and what they reference", async () => {
    const { w, ports } = memoryPorts({
      folders: [folder("root")],
      connections: [conn("a", { folder_id: "root", key_id: "k" })],
      keys: [key("k")],
    });
    await paste(adapterFor("hosts", ports, { vaultId: "team" }), "cut", [], ["root"]);
    expect(w.folders[0].vault_id).toBe("team");
    expect(w.connections[0]).toMatchObject({ vault_id: "team", folder_id: "root" });
    expect(w.keys[0].vault_id).toBe("team");
  });

  it("points a duplicated identity at the duplicated key", async () => {
    const { w, ports } = memoryPorts({ keys: [key("k")], identities: [identity("i", { key_id: "k" })] });
    await paste(adapterFor("keychain", ports, { vaultId: "team" }), "copy", [
      { id: "i", kind: "identity" }, { id: "k", kind: "key" },
    ]);
    const keyCopy = w.keys.find((k) => k.vault_id === "team")!;
    expect(w.identities.find((i) => i.vault_id === "team")!.key_id).toBe(keyCopy.id);
  });

  it("carries a snippet's nested callee and points the copy at it", async () => {
    const { w, ports } = memoryPorts({
      snippets: [snippet("outer", { steps: [{ kind: "snippet", snippet_id: "inner" }] }), snippet("inner")],
    });
    await paste(adapterFor("snippets", ports, { vaultId: "team" }), "copy", [{ id: "outer", kind: "snippet" }]);
    const inner = w.snippets.find((s) => s.vault_id === "team" && s.name === "inner")!;
    const outer = w.snippets.find((s) => s.vault_id === "team" && s.name === "outer")!;
    expect(outer.steps).toEqual([{ kind: "snippet", snippet_id: inner.id }]);
    expect(outer.favorite).toBe(false);
  });

  it("carries a rule's hosts on a cross-vault move, and only reparents within a vault", async () => {
    const { w, ports } = memoryPorts({ rules: [rule("r", { connection_ids: ["h"] })], connections: [conn("h")] });
    await paste(adapterFor("port-forwarding", ports, { vaultId: "team" }), "cut", [{ id: "r", kind: "port_forward" }]);
    expect(w.rules[0].vault_id).toBe("team");
    expect(w.connections[0].vault_id).toBe("team");

    const same = memoryPorts({ rules: [rule("r")], folders: [folder("f", { object_type: "port_forwarding" })] });
    await paste(adapterFor("port-forwarding", same.ports, { folderId: "f", vaultId: null }), "cut", [{ id: "r", kind: "port_forward" }]);
    expect(same.ports.moveRuleFolder).toHaveBeenCalledWith("r", "f");
  });

  it("deletes each id through the store method for its kind", async () => {
    const { ports } = memoryPorts({ keys: [key("k")], identities: [identity("i")] });
    await adapterFor("keychain", ports, { vaultId: null }).deleteItems(["k", "i"]);
    expect(ports.deleteKey).toHaveBeenCalledWith("k");
    expect(ports.deleteIdentity).toHaveBeenCalledWith("i");
  });
});
