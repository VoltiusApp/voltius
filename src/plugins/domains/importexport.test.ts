import { describe, it, expect, vi, beforeEach } from "vitest";

const conn = { id: "c1", name: "web", host: "h", port: 22, username: "u", vault_id: "personal" };

vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: { getState: () => ({
    connections: [conn], teamConnections: {},
    saveConnection: vi.fn(async () => conn), updateConnection: vi.fn(async () => {}),
    loadConnections: vi.fn(async () => {}),
  }) },
}));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: { getState: () => ({ identities: [], teamIdentities: {}, saveIdentity: vi.fn(), loadIdentities: vi.fn(async () => {}) }) },
}));
vi.mock("@/stores/keyStore", () => ({
  useKeyStore: { getState: () => ({ keys: [], teamKeys: {}, saveKey: vi.fn(), loadKeys: vi.fn(async () => {}) }) },
}));
vi.mock("@/stores/folderStore", () => ({
  useFolderStore: { getState: () => ({ folders: [], teamFolders: {}, saveFolder: vi.fn(), loadFolders: vi.fn(async () => {}) }) },
}));
vi.mock("@/stores/snippetStore", () => ({
  useSnippetStore: { getState: () => ({ snippets: [], teamSnippets: {}, createSnippet: vi.fn(), updateSnippet: vi.fn(), loadSnippets: vi.fn(async () => {}) }) },
}));
const teamSnippetFolder = { id: "sf1", name: "Team Folder" };
vi.mock("@/stores/snippetFolderStore", () => ({
  useSnippetFolderStore: { getState: () => ({
    folders: [], teamSnippetFolders: { "team-a": [teamSnippetFolder] },
    saveFolder: vi.fn(), loadFolders: vi.fn(async () => {}),
  }) },
}));
vi.mock("@/stores/portForwardingStore", () => ({
  usePortForwardingStore: { getState: () => ({ rules: [], teamRules: {}, createRule: vi.fn(), loadRules: vi.fn(async () => {}) }) },
}));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: { getState: () => ({ teams: [{ id: "team-a" }] }) } }));

// formats.ts and importers.ts are NOT mocked: the round-trip test below only
// proves anything if the real encryptText/decryptText/detectFormat/fromJSON run.
vi.mock("@/services/import-export/registry", () => ({
  HANDLERS: [{ key: "connections" }, { key: "identities" }, { key: "keys" }, { key: "snippets" }, { key: "portForwardingRules" }],
  buildBundle: vi.fn(async () => ({
    version: 1, exported_at: "", folders: [], connections: [{ _eid: "e1", name: "web", password: "hunter2" }],
    identities: [], keys: [], snippets: [], portForwardingRules: [],
  })),
  runImport: vi.fn(async () => ({ imported: 1, errors: 0 })),
  reloadAll: vi.fn(async () => {}),
}));

import { exportObjects, importObjects } from "./importexport";

beforeEach(() => vi.clearAllMocks());

describe("import/export domain", () => {
  it("refuses a secret-bearing export without a passphrase, naming the types", async () => {
    const r = await exportObjects({ vaultIds: ["personal"], types: ["connections"], format: "json" });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("connections");
  });

  it("encrypts when a passphrase is given", async () => {
    const r = await exportObjects({ vaultIds: ["personal"], types: ["connections"], format: "json", passphrase: "pw" });
    expect(r.ok).toBe(true);
    const res = (r as { result: { content: string; encrypted: boolean } }).result;
    expect(res.encrypted).toBe(true);
    expect(res.content).not.toContain("hunter2");
  });

  it("round-trips: what it encrypts, importObjects decrypts", async () => {
    const e = await exportObjects({ vaultIds: ["personal"], types: ["connections"], format: "json", passphrase: "pw" });
    const content = (e as { result: { content: string } }).result.content;
    const i = await importObjects({ content, vaultId: "personal", passphrase: "pw", dryRun: false });
    expect(i).toEqual({ ok: true, result: expect.objectContaining({ imported: 1, dryRun: false }) });
  });

  it("refuses encrypted input with no passphrase", async () => {
    const e = await exportObjects({ vaultIds: ["personal"], types: ["connections"], format: "json", passphrase: "pw" });
    const content = (e as { result: { content: string } }).result.content;
    const r = await importObjects({ content, vaultId: "personal", dryRun: false });
    expect(r.ok).toBe(false);
  });

  it("merges team snippet folders into the store slices passed to buildBundle", async () => {
    const { buildBundle } = await import("@/services/import-export/registry");
    await exportObjects({ vaultIds: ["personal"], types: ["connections"], format: "json", passphrase: "pw" });
    const stores = vi.mocked(buildBundle).mock.calls[0][1];
    expect(stores.snippetFolders.map((f) => f.id)).toContain(teamSnippetFolder.id);
  });

  it("dry_run reports counts and writes nothing", async () => {
    const { runImport } = await import("@/services/import-export/registry");
    const r = await importObjects({
      content: JSON.stringify({ version: 1, folders: [], connections: [{ _eid: "e1", name: "web" }], identities: [], keys: [], snippets: [], portForwardingRules: [] }),
      vaultId: "personal", dryRun: true,
    });
    expect(r).toEqual({ ok: true, result: { imported: 0, errors: 0, counts: expect.objectContaining({ connections: 1 }), dryRun: true } });
    expect(runImport).not.toHaveBeenCalled();
  });
});
