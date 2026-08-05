import { describe, it, expect } from "vitest";
import type { Folder } from "@/types";
import { folderSubtreeIds, itemsInFolderSubtree } from "./folderTree";

function folder(id: string, parent?: string): Folder {
  return {
    id,
    name: id,
    object_type: "connection",
    parent_folder_id: parent,
    vault_id: "personal",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    clocks: {},
  } as Folder;
}

describe("folderSubtreeIds", () => {
  it("collects the root and every nested descendant", () => {
    const folders = [folder("root"), folder("child", "root"), folder("grandchild", "child"), folder("sibling")];
    expect(folderSubtreeIds(folders, "root")).toEqual(new Set(["root", "child", "grandchild"]));
  });

  it("returns just the root when it has no children", () => {
    expect(folderSubtreeIds([folder("root"), folder("other")], "root")).toEqual(new Set(["root"]));
  });

  it("terminates on a parent cycle", () => {
    expect(folderSubtreeIds([folder("a", "b"), folder("b", "a")], "a")).toEqual(new Set(["a", "b"]));
  });
});

describe("itemsInFolderSubtree", () => {
  it("picks up items filed in subfolders, not unfoldered or unrelated ones", () => {
    const folders = [folder("root"), folder("child", "root"), folder("other")];
    const items = [
      { id: "in-root", folder_id: "root" },
      { id: "in-child", folder_id: "child" },
      { id: "elsewhere", folder_id: "other" },
      { id: "top-level", folder_id: null },
    ];
    expect(itemsInFolderSubtree(items, folders, "root").map((i) => i.id)).toEqual(["in-root", "in-child"]);
  });
});
