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

import { useSnippetFolderStore } from "./snippetFolderStore";
import { useSnippetStore } from "./snippetStore";
import { useTeamStore } from "./teamStore";

const TEAM = "team-1";

function folder(id: string, parent?: string) {
  return {
    id, name: id, object_type: "snippet", parent_folder_id: parent,
    vault_id: TEAM, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", clocks: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.invoke.mockResolvedValue([]);
  useSnippetFolderStore.setState({ folders: [], teamSnippetFolders: {} });
  useSnippetStore.setState({ snippets: [], teamSnippets: {} });
  useTeamStore.setState({ teams: [] });
});

test("personal delete refreshes snippets, since the backend cascaded over them", async () => {
  const listed: string[] = [];
  h.invoke.mockImplementation(async (cmd: string) => {
    listed.push(cmd);
    return [];
  });

  await useSnippetFolderStore.getState().deleteFolder("f1");

  expect(listed).toContain("snippet_folder_delete");
  expect(listed).toContain("snippet_list");
});

test("team delete removes the subtree and every snippet filed in it", async () => {
  useTeamStore.setState({ teams: [{ id: TEAM, name: "T" }] as never });
  useSnippetFolderStore.setState({
    teamSnippetFolders: { [TEAM]: [folder("root"), folder("child", "root"), folder("other")] as never },
  });
  useSnippetStore.setState({
    teamSnippets: {
      [TEAM]: [
        { id: "s-child", folder_id: "child", vault_id: TEAM },
        { id: "s-other", folder_id: "other", vault_id: TEAM },
        { id: "s-loose", folder_id: null, vault_id: TEAM },
      ] as never,
    },
  });

  await useSnippetFolderStore.getState().deleteFolder("root");

  const removed = h.removeTeamVaultObject.mock.calls.map((c) => (c as unknown as [string, string])[1]);
  expect(removed).toEqual(expect.arrayContaining(["s-child", "root", "child"]));
  expect(removed).not.toContain("s-other");
  expect(removed).not.toContain("s-loose");

  expect(useSnippetFolderStore.getState().teamSnippetFolders[TEAM].map((f) => f.id)).toEqual(["other"]);
  expect(useSnippetStore.getState().teamSnippets[TEAM].map((s) => s.id)).toEqual(["s-other", "s-loose"]);
});
