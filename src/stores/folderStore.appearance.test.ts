// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/teamObjectPersistence", () => ({
  removeTeamVaultObject: vi.fn(async () => {}),
  saveTeamVaultObject: vi.fn(async () => {}),
}));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));
vi.mock("@/services/account", () => ({ isServerMode: async () => false }));
vi.mock("@/services/auditMutations", () => ({ reportAuditMutation: vi.fn() }));

import { useFolderStore } from "./folderStore";
import { useSnippetFolderStore } from "./snippetFolderStore";
import { useTeamStore } from "./teamStore";

const styled = {
  id: "f1", name: "Prod", object_type: "connection", vault_id: "personal",
  color: "#ef4444", icon: "lucide:flame", created_at: "", updated_at: "", clocks: {},
};

const payload = (command: string) => h.invoke.mock.calls.find(([c]) => c === command)?.[1]?.data;

beforeEach(() => {
  vi.clearAllMocks();
  h.invoke.mockResolvedValue([]);
  useTeamStore.setState({ teams: [] });
  useFolderStore.setState({ folders: [{ ...styled } as never], teamFolders: {} });
  useSnippetFolderStore.setState({ folders: [{ ...styled, object_type: "snippet" } as never], teamSnippetFolders: {} });
});

test("a rename that omits color and icon keeps them", async () => {
  await useFolderStore.getState().updateFolder("f1", { name: "Prod renamed", object_type: "connection" });
  expect(payload("folder_update")).toMatchObject({ name: "Prod renamed", color: "#ef4444", icon: "lucide:flame", vault_id: "personal" });
});

test("an explicit undefined clears the color", async () => {
  await useFolderStore.getState().updateFolder("f1", { name: "Prod", object_type: "connection", color: undefined });
  expect(payload("folder_update")?.color).toBeUndefined();
  expect(payload("folder_update")).toHaveProperty("icon", "lucide:flame");
});

test("a snippet folder rename keeps color and icon", async () => {
  await useSnippetFolderStore.getState().updateFolder("f1", { name: "Docker", object_type: "snippet" });
  expect(payload("snippet_folder_update")).toMatchObject({ name: "Docker", color: "#ef4444", icon: "lucide:flame" });
});
