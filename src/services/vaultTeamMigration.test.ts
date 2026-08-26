import { describe, test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const svc = () => ({
    list: vi.fn(async () => [] as unknown[]),
    remove: vi.fn(async () => {}),
  });
  return {
    saveTeamVaultObject: vi.fn(async (_teamId: string, _kind: string, _item: unknown) => {}),
    removeTeamVaultObject: vi.fn(async () => {}),
    backfillExistingTeamVaultSecrets: vi.fn(async () => {}),
    reportAuditMutation: vi.fn(),
    scheduleSync: vi.fn(),
    isServerMode: vi.fn(async () => true),
    connections: svc(),
    identities: svc(),
    keys: svc(),
    snippets: svc(),
    folders: svc(),
    snippetFolders: svc(),
    rules: svc(),
  };
});

vi.mock("@/services/teamObjectPersistence", () => ({
  saveTeamVaultObject: h.saveTeamVaultObject,
  removeTeamVaultObject: h.removeTeamVaultObject,
}));
vi.mock("@/services/teamVaultSecrets", () => ({
  backfillExistingTeamVaultSecrets: h.backfillExistingTeamVaultSecrets,
}));
vi.mock("@/services/auditMutations", () => ({ reportAuditMutation: h.reportAuditMutation }));
vi.mock("@/services/sync", () => ({ scheduleSync: h.scheduleSync }));
vi.mock("@/services/account", () => ({ isServerMode: h.isServerMode }));
vi.mock("@/services/connections", () => ({
  listConnections: h.connections.list, deleteConnection: h.connections.remove,
}));
vi.mock("@/services/identities", () => ({
  listIdentities: h.identities.list, deleteIdentity: h.identities.remove,
}));
vi.mock("@/services/keys", () => ({
  listKeys: h.keys.list, deleteKey: h.keys.remove,
}));
vi.mock("@/services/snippets", () => ({
  listSnippets: h.snippets.list, deleteSnippet: h.snippets.remove,
  listSnippetFolders: h.snippetFolders.list, deleteSnippetFolder: h.snippetFolders.remove,
}));
vi.mock("@/services/folders", () => ({
  listFolders: h.folders.list, deleteFolder: h.folders.remove,
}));
vi.mock("@/services/portForwardingRules", () => ({
  listPfRules: h.rules.list, deletePfRule: h.rules.remove,
}));

import { migrateVaultToTeam } from "./vaultTeamMigration";
import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";

const VAULT = "vault-1";
const TEAM = "team-1";

function seedVault() {
  useConnectionStore.setState({
    connections: [
      { id: "c1", name: "prod", vault_id: VAULT },
      { id: "c2", name: "elsewhere", vault_id: "other-vault" },
      { id: "c3", name: "personal-host" },
    ] as never,
    teamConnections: {},
  });
  useIdentityStore.setState({ identities: [{ id: "i1", vault_id: VAULT }] as never, teamIdentities: {} });
  useKeyStore.setState({ keys: [{ id: "k1", vault_id: VAULT }] as never, teamKeys: {} });
  useFolderStore.setState({ folders: [{ id: "f1", vault_id: VAULT }] as never, teamFolders: {} });
  useSnippetStore.setState({ snippets: [{ id: "s1", vault_id: VAULT }] as never, teamSnippets: {} });
  useSnippetFolderStore.setState({ folders: [{ id: "sf1", vault_id: VAULT }] as never, teamSnippetFolders: {} });
  usePortForwardingStore.setState({ rules: [{ id: "r1", vault_id: VAULT }] as never, teamRules: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  seedVault();
});

describe("migrateVaultToTeam", () => {
  test("uploads every object the vault already held", async () => {
    await migrateVaultToTeam(VAULT, TEAM);

    const uploaded = h.saveTeamVaultObject.mock.calls.map(([teamId, kind, item]) => [
      teamId, kind, (item as { id: string }).id,
    ]);
    expect(uploaded).toEqual(expect.arrayContaining([
      [TEAM, "connection", "c1"],
      [TEAM, "identity", "i1"],
      [TEAM, "key", "k1"],
      [TEAM, "folder", "f1"],
      [TEAM, "snippet", "s1"],
      [TEAM, "snippet_folder", "sf1"],
      [TEAM, "port_forwarding_rule", "r1"],
    ]));
    expect(uploaded).toHaveLength(7);
  });

  test("re-files uploaded objects under the team id", async () => {
    await migrateVaultToTeam(VAULT, TEAM);

    const [, , item] = h.saveTeamVaultObject.mock.calls[0];
    expect(item).toMatchObject({ id: "c1", vault_id: TEAM });
    expect(useConnectionStore.getState().teamConnections[TEAM]).toHaveLength(1);
  });

  test("uploads secrets before the local objects that own them are deleted", async () => {
    const order: string[] = [];
    h.backfillExistingTeamVaultSecrets.mockImplementation(async () => { order.push("secrets"); });
    h.connections.remove.mockImplementation(async () => { order.push("delete"); });

    await migrateVaultToTeam(VAULT, TEAM);

    expect(order).toEqual(["secrets", "delete"]);
  });

  test("drops the local copies so the team vault is the only source of truth", async () => {
    await migrateVaultToTeam(VAULT, TEAM);

    expect(h.connections.remove).toHaveBeenCalledWith("c1");
    expect(h.connections.remove).not.toHaveBeenCalledWith("c2");
    expect(h.identities.remove).toHaveBeenCalledWith("i1");
    expect(h.rules.remove).toHaveBeenCalledWith("r1");
  });

  test("a failed upload leaves everything local untouched", async () => {
    h.saveTeamVaultObject.mockImplementation(async (_t, kind) => {
      if (kind === "key") throw new Error("upload failed");
    });

    await expect(migrateVaultToTeam(VAULT, TEAM)).rejects.toThrow("upload failed");

    expect(h.connections.remove).not.toHaveBeenCalled();
    expect(h.backfillExistingTeamVaultSecrets).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().connections).toHaveLength(3);
  });
});
