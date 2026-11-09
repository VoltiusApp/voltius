import { test, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Folder } from "@/types";

const h = vi.hoisted(() => ({
  selectedVaultIds: ["personal"] as string[],
  can: vi.fn((_permission: string, _vaultId: string, _objectId?: string) => true),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => h.can }));
vi.mock("@/hooks/useWritableVaultIds", () => ({ useDefaultVaultId: () => "personal" }));
vi.mock("@/stores/vaultStore", () => ({
  useVaultStore: (sel: (s: { selectedVaultIds: string[] }) => unknown) => sel({ selectedVaultIds: h.selectedVaultIds }),
}));

import { useNewFolder } from "./useNewFolder";

function folder(id: string, vault_id: string): Folder {
  return { id, name: id, created_at: "", object_type: "connection", vault_id, updated_at: "", clocks: {} };
}

beforeEach(() => {
  h.selectedVaultIds = ["personal"];
  h.can.mockReset().mockReturnValue(true);
});

test("a folder created inside a team folder goes to that folder's vault", () => {
  const { result } = renderHook(() => useNewFolder("snippet", [folder("root", "team-1"), folder("child", "team-1")]));
  expect(result.current.newFolder("New")).toEqual({
    name: "New", object_type: "snippet", parent_folder_id: "child", vault_id: "team-1",
  });
});

test("a folder created at the root goes to the default vault", () => {
  const { result } = renderHook(() => useNewFolder("keychain", []));
  expect(result.current.newFolder("New")).toEqual({
    name: "New", object_type: "keychain", parent_folder_id: undefined, vault_id: "personal",
  });
});

test("inside a folder, creating needs EDIT_FOLDERS on that folder", () => {
  h.can.mockImplementation((_p, vaultId) => vaultId !== "team-1");
  const { result } = renderHook(() => useNewFolder("connection", [folder("child", "team-1")]));
  expect(result.current.folderBlocked).toBe("folders.noPermissionCreate");
  expect(h.can).toHaveBeenCalledWith("EDIT_FOLDERS", "team-1", "child");
});

test("at the root, creating needs EDIT_FOLDERS on a selected vault", () => {
  h.selectedVaultIds = ["team-1"];
  h.can.mockImplementation((_p, vaultId) => vaultId !== "team-1");
  expect(renderHook(() => useNewFolder("connection", [])).result.current.folderBlocked).toBe("folders.noPermissionCreate");

  h.selectedVaultIds = ["team-1", "personal"];
  expect(renderHook(() => useNewFolder("connection", [])).result.current.folderBlocked).toBeUndefined();
});
