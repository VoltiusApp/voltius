import { test, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFolderNavigation } from "./useFolderNavigation";

test("a folder whose parent is hidden is listed at the root", () => {
  const { result } = renderHook(() => useFolderNavigation([
    { id: "a", parent_folder_id: null },
    { id: "b", parent_folder_id: "hidden" },
  ]));
  expect(result.current.visibleFolders.map((f) => f.id)).toEqual(["a", "b"]);
});
