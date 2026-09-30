import { test, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFolderNavigation } from "./useFolderNavigation";

test("a folder whose parent is hidden is listed at the root", () => {
  const { result } = renderHook(() => useFolderNavigation([
    { id: "a", parent_folder_id: null },
    { id: "b", parent_folder_id: "hidden" },
  ]));
  expect(result.current.visibleFolders.map((f) => f.id)).toEqual(["a", "b"]);
});

test("a path into folders that left the list falls back to the root", () => {
  const vaultA = [{ id: "a", parent_folder_id: null }];
  const { result, rerender } = renderHook(({ folders }) => useFolderNavigation(folders), { initialProps: { folders: vaultA } });
  act(() => result.current.navigateInto(vaultA[0]));
  expect(result.current.activeFolderId).toBe("a");

  rerender({ folders: [{ id: "b", parent_folder_id: null }] });
  expect(result.current.activeFolderId).toBeNull();
  expect(result.current.folderPath).toEqual([]);

  rerender({ folders: vaultA });
  expect(result.current.activeFolderId).toBeNull();
});
