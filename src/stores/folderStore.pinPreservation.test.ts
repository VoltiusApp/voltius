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
import { useTeamStore } from "./teamStore";

const pinned = {
  id: "f1", name: "Prod", object_type: "connection", vault_id: "personal",
  pinned: true, created_at: "", updated_at: "", clocks: {},
};

/** `folder_update` assigns `folder.pinned = data.pinned` outright, and the Rust
 *  field is `#[serde(default)] Option<bool>` — so a payload that omits `pinned`
 *  clears it rather than leaving it alone. */
const updatePayload = () => h.invoke.mock.calls.find(([c]) => c === "folder_update")?.[1]?.data;

beforeEach(() => {
  vi.clearAllMocks();
  h.invoke.mockResolvedValue([]);
  useTeamStore.setState({ teams: [] });
  useFolderStore.setState({ folders: [{ ...pinned } as never], teamFolders: {} });
});

test("renaming a pinned folder keeps it pinned", async () => {
  await useFolderStore.getState().updateFolder("f1", {
    name: "Prod renamed", object_type: "connection",
    parent_folder_id: undefined, vault_id: "personal",
  });
  expect(updatePayload()).toHaveProperty("pinned", true);
});

test("moving a pinned folder keeps it pinned", async () => {
  await useFolderStore.getState().moveFolder("f1", null);
  expect(updatePayload()).toHaveProperty("pinned", true);
});

test("an explicit unpin still unpins", async () => {
  await useFolderStore.getState().updateFolder("f1", {
    name: "Prod", object_type: "connection",
    parent_folder_id: undefined, vault_id: "personal", pinned: false,
  });
  expect(updatePayload()).toHaveProperty("pinned", false);
});

test("an unpinned folder is not accidentally pinned by a rename", async () => {
  useFolderStore.setState({ folders: [{ ...pinned, pinned: undefined } as never], teamFolders: {} });
  await useFolderStore.getState().updateFolder("f1", {
    name: "Prod renamed", object_type: "connection",
    parent_folder_id: undefined, vault_id: "personal",
  });
  expect(updatePayload()?.pinned).toBeUndefined();
});
