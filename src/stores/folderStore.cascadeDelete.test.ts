import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  removeTeamVaultObject: vi.fn(async () => {}),
  saveTeamVaultObject: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/teamObjectPersistence", () => ({
  removeTeamVaultObject: h.removeTeamVaultObject,
  saveTeamVaultObject: h.saveTeamVaultObject,
}));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));
vi.mock("@/services/account", () => ({ isServerMode: async () => false }));
vi.mock("@/services/auditMutations", () => ({ reportAuditMutation: vi.fn() }));

import { useFolderStore } from "./folderStore";
import { useConnectionStore } from "./connectionStore";
import { useKeyStore } from "./keyStore";
import { useIdentityStore } from "./identityStore";
import { usePortForwardingStore } from "./portForwardingStore";
import { useTeamStore } from "./teamStore";

const TEAM = "team-1";

function folder(id: string, parent?: string) {
  return {
    id, name: id, object_type: "connection", parent_folder_id: parent,
    vault_id: TEAM, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", clocks: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.invoke.mockResolvedValue([]);
  useFolderStore.setState({ folders: [], teamFolders: {} });
  useConnectionStore.setState({ connections: [], teamConnections: {} });
  useKeyStore.setState({ keys: [], teamKeys: {} });
  useIdentityStore.setState({ identities: [], teamIdentities: {} });
  usePortForwardingStore.setState({ rules: [], teamRules: {} });
  useTeamStore.setState({ teams: [] });
});

test("personal delete refreshes every item type the backend cascaded over", async () => {
  const listed: string[] = [];
  h.invoke.mockImplementation(async (cmd: string) => {
    listed.push(cmd);
    return [];
  });

  await useFolderStore.getState().deleteFolder("f1");

  expect(listed).toContain("folder_delete");
  expect(listed).toContain("connection_list");
  expect(listed).toContain("identity_list");
  expect(listed).toContain("key_list");
  expect(listed).toContain("pf_rule_list");
});

test("cascade:false deletes only the folder — undoing a creation must not eat its contents", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    calls.push([cmd, args]);
    return [];
  });

  await useFolderStore.getState().deleteFolder("f1", { cascade: false });

  expect(calls.find(([c]) => c === "folder_delete")?.[1]).toEqual({ id: "f1", cascade: false });
  expect(calls.map(([c]) => c)).not.toContain("connection_list");
});

test("team delete removes the subtree and every object filed in it", async () => {
  useTeamStore.setState({ teams: [{ id: TEAM, name: "T" }] as never });
  useFolderStore.setState({
    teamFolders: { [TEAM]: [folder("root"), folder("child", "root"), folder("other")] as never },
  });
  useConnectionStore.setState({
    teamConnections: {
      [TEAM]: [
        { id: "c-root", folder_id: "root", vault_id: TEAM },
        { id: "c-child", folder_id: "child", vault_id: TEAM },
        { id: "c-other", folder_id: "other", vault_id: TEAM },
        { id: "c-loose", folder_id: null, vault_id: TEAM },
      ] as never,
    },
  });
  usePortForwardingStore.setState({
    teamRules: { [TEAM]: [{ id: "r-child", folder_id: "child", vault_id: TEAM }] as never },
  });

  await useFolderStore.getState().deleteFolder("root");

  const removed = h.removeTeamVaultObject.mock.calls.map((c) => (c as unknown as [string, string])[1]);
  expect(removed).toEqual(expect.arrayContaining(["c-root", "c-child", "r-child", "root", "child"]));
  expect(removed).not.toContain("c-other");
  expect(removed).not.toContain("c-loose");
  expect(removed).not.toContain("other");

  expect(useFolderStore.getState().teamFolders[TEAM].map((f) => f.id)).toEqual(["other"]);
  expect(useConnectionStore.getState().teamConnections[TEAM].map((c) => c.id)).toEqual(["c-other", "c-loose"]);
  expect(usePortForwardingStore.getState().teamRules[TEAM]).toEqual([]);
});
