import { test, expect, vi, beforeEach } from "vitest";

/**
 * The vault record used to be the only thing a delete removed, leaving its
 * objects alive under a vault_id nothing resolves. These cover the wiring that
 * fixes that: the seven real store deleters, reached through `vaultPorts`, and
 * the ordering that keeps a failed sweep from orphaning what survived it.
 */

const h = vi.hoisted(() => {
  const object = (id: string, vault_id?: string) => ({ id, vault_id });
  return {
    removeVault: vi.fn(),
    deleteConnection: vi.fn(async () => {}),
    deleteKey: vi.fn(async () => {}),
    deleteIdentity: vi.fn(async () => {}),
    deleteSnippet: vi.fn(async () => {}),
    deleteRule: vi.fn(async () => {}),
    deleteFolder: vi.fn(async () => {}),
    deleteSnippetFolder: vi.fn(async () => {}),
    load: vi.fn(async () => {}),
    object,
    // A vi.mock factory is hoisted above module scope, so this helper has to
    // live in the hoisted block with the fns it wraps.
    storeMock: <T extends object>(state: T) => ({ getState: () => state }),
  };
});

vi.mock("@/stores/vaultStore", () => ({
  useVaultStore: h.storeMock({
    vaults: [{ id: "v1", name: "Work" }, { id: "personal", name: "Personal" }],
    addVault: vi.fn(),
    renameVault: vi.fn(),
    removeVault: h.removeVault,
  }),
}));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: h.storeMock({ teams: [] }) }));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: h.storeMock({
    loadConnections: h.load,
    connections: [h.object("c1", "v1"), h.object("c2", "other")],
    deleteConnection: h.deleteConnection,
  }),
}));
vi.mock("@/stores/keyStore", () => ({
  useKeyStore: h.storeMock({ loadKeys: h.load, keys: [h.object("k1", "v1")], deleteKey: h.deleteKey }),
}));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: h.storeMock({
    loadIdentities: h.load, identities: [h.object("i1", "v1")], deleteIdentity: h.deleteIdentity,
  }),
}));
vi.mock("@/stores/snippetStore", () => ({
  useSnippetStore: h.storeMock({
    loadSnippets: h.load, snippets: [h.object("s1", "v1")], deleteSnippet: h.deleteSnippet,
  }),
}));
vi.mock("@/stores/portForwardingStore", () => ({
  usePortForwardingStore: h.storeMock({
    loadRules: h.load, rules: [h.object("p1", "v1")], deleteRule: h.deleteRule,
  }),
}));
vi.mock("@/stores/folderStore", () => ({
  useFolderStore: h.storeMock({
    loadFolders: h.load, folders: [h.object("f1", "v1")], deleteFolder: h.deleteFolder,
  }),
}));
vi.mock("@/stores/snippetFolderStore", () => ({
  useSnippetFolderStore: h.storeMock({
    loadFolders: h.load, folders: [h.object("sf1", "v1")], deleteFolder: h.deleteSnippetFolder,
  }),
}));

import { deleteVaultWithContents } from "./vaultObjectStores";

beforeEach(() => {
  for (const fn of Object.values(h)) if (typeof fn === "function" && "mockClear" in fn) fn.mockClear();
});

test("deleting a vault deletes every object filed in it, then the vault record", async () => {
  await deleteVaultWithContents("v1");

  expect(h.deleteConnection).toHaveBeenCalledWith("c1");
  expect(h.deleteKey).toHaveBeenCalledWith("k1");
  expect(h.deleteIdentity).toHaveBeenCalledWith("i1");
  expect(h.deleteSnippet).toHaveBeenCalledWith("s1");
  expect(h.deleteRule).toHaveBeenCalledWith("p1");
  expect(h.deleteFolder).toHaveBeenCalledWith("f1", { cascade: false });
  expect(h.deleteSnippetFolder).toHaveBeenCalledWith("sf1");
  expect(h.removeVault).toHaveBeenCalledWith("v1");
});

test("objects filed in another vault are left alone", async () => {
  await deleteVaultWithContents("v1");
  expect(h.deleteConnection).toHaveBeenCalledTimes(1);
  expect(h.deleteConnection).not.toHaveBeenCalledWith("c2");
});

// The stores the Snippets and Port Forwarding pages own are empty in a session
// that never opened them, and an empty read is what turns this sweep into
// silently orphaning their contents.
test("the lazily-loaded stores are hydrated before anything is counted", async () => {
  await deleteVaultWithContents("v1");
  expect(h.load).toHaveBeenCalled();
  const firstDelete = Math.min(...[h.deleteConnection, h.deleteSnippet, h.deleteRule]
    .map((fn) => fn.mock.invocationCallOrder[0]));
  expect(Math.max(...h.load.mock.invocationCallOrder)).toBeLessThan(firstDelete);
});

test("a failed sweep leaves the vault record, so survivors stay filed under a name", async () => {
  h.deleteKey.mockRejectedValueOnce(new Error("disk is full"));

  await expect(deleteVaultWithContents("v1")).rejects.toThrow("disk is full");
  expect(h.removeVault).not.toHaveBeenCalled();
});

test("the personal vault is refused", async () => {
  await expect(deleteVaultWithContents("personal")).rejects.toThrow(/personal vault cannot be deleted/);
  expect(h.removeVault).not.toHaveBeenCalled();
  expect(h.deleteConnection).not.toHaveBeenCalled();
});
