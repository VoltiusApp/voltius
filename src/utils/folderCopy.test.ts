import { describe, it, expect } from "vitest";
import type { Folder } from "@/types";
import { cloneFolderTree, copyFolderSubtree } from "./folderCopy";

const folder = (id: string, extra: Partial<Folder> = {}): Folder => ({
  id, name: id, object_type: "connection", vault_id: "personal",
  created_at: "", updated_at: "", clocks: {}, ...extra,
} as Folder);

function recorder() {
  const saved: Record<string, unknown>[] = [];
  let n = 0;
  const saveFolder = async (data: Record<string, unknown>) => {
    saved.push(data);
    return { id: `new-${++n}` };
  };
  return { saved, saveFolder };
}

describe("cloneFolderTree", () => {
  it("keeps the color and icon of the root and every subfolder", async () => {
    const { saved, saveFolder } = recorder();
    await cloneFolderTree({
      root: folder("root", { color: "#ef4444", icon: "lucide:server" }),
      subFolders: [folder("child", { parent_folder_id: "root", color: "#22c55e", icon: "lucide:database" })],
      parentFolderId: null,
      vaultId: "personal",
      keepName: false,
      saveFolder,
    });
    expect(saved.map(({ color, icon }) => ({ color, icon }))).toEqual([
      { color: "#ef4444", icon: "lucide:server" },
      { color: "#22c55e", icon: "lucide:database" },
    ]);
  });
});

describe("copyFolderSubtree", () => {
  it("keeps the color and icon when copying into another vault", async () => {
    const { saved, saveFolder } = recorder();
    await copyFolderSubtree({
      root: folder("root", { color: "#3b82f6", icon: "lucide:cloud" }),
      subFolders: [],
      vaultId: "team-1",
      existingFolders: [],
      saveFolder,
    });
    expect(saved[0]).toMatchObject({ color: "#3b82f6", icon: "lucide:cloud", vault_id: "team-1" });
  });
});
