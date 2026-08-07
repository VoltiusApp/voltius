import { describe, it, expect } from "vitest";
import type { Folder } from "@/types";
import { descendantFolders, folderSubtreeIds, itemsInFolderSubtree } from "@/utils/folderTree";

function folder(id: string, parent?: string): Folder {
  return {
    id, name: id, created_at: "", updated_at: "", clocks: {},
    object_type: "connection", vault_id: "personal", parent_folder_id: parent,
  } as Folder;
}

describe("descendantFolders", () => {
  it("returns the whole subtree breadth-first, parents before children", () => {
    const folders = [
      folder("root"),
      folder("a", "root"),
      folder("b", "root"),
      folder("a1", "a"),
      folder("a1x", "a1"),
      folder("elsewhere"),
    ];
    expect(descendantFolders(folders, "root").map((f) => f.id)).toEqual(["a", "b", "a1", "a1x"]);
  });

  it("excludes the root itself and returns nothing for a leaf", () => {
    expect(descendantFolders([folder("solo")], "solo")).toEqual([]);
  });

  it("terminates on a parent cycle instead of spinning", () => {
    const a = folder("a", "b");
    const b = folder("b", "a");
    expect(descendantFolders([a, b], "a").map((f) => f.id)).toEqual(["b"]);
  });

  it("ignores a folder whose parent is missing", () => {
    expect(descendantFolders([folder("root"), folder("orphan", "ghost")], "root")).toEqual([]);
  });
});

describe("folderSubtreeIds", () => {
  it("includes the root and every descendant", () => {
    const folders = [folder("root"), folder("a", "root"), folder("a1", "a"), folder("other")];
    expect([...folderSubtreeIds(folders, "root")].sort()).toEqual(["a", "a1", "root"]);
  });
});

describe("itemsInFolderSubtree", () => {
  it("keeps only items filed somewhere in the subtree, in their original order", () => {
    const folders = [folder("root"), folder("a", "root")];
    const items = [
      { id: "1", folder_id: "a" },
      { id: "2", folder_id: null },
      { id: "3", folder_id: "root" },
      { id: "4", folder_id: "other" },
    ];
    expect(itemsInFolderSubtree(items, folders, "root").map((i) => i.id)).toEqual(["1", "3"]);
  });
});
