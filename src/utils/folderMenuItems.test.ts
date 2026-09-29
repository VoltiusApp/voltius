import { expect, test, vi } from "vitest";
import { buildFolderMenuItems } from "./folderMenuItems";

test("the card and the panel get the same items, the panel without Rename/Edit", () => {
  const base = {
    t: ((k: string) => k) as never, onOpen: vi.fn(), pinItem: { label: "pin", onClick: vi.fn() }, pinTeamItem: null,
    onExport: vi.fn(), clipboard: [{ label: "cut", onClick: vi.fn() }, { label: "copy", onClick: vi.fn() }],
    canEdit: true, isSynced: true, onToggleSync: vi.fn(), onDelete: vi.fn(),
  };
  const card = buildFolderMenuItems({ ...base, editItems: [{ label: "rename", onClick: vi.fn() }, { label: "edit", onClick: vi.fn() }] });
  const panel = buildFolderMenuItems(base);
  expect(card.map((i) => i.label)).toEqual([
    "folders.card.openFolder", "rename", "edit", "pin", "folders.card.exportFolder", "cut", "copy",
    "folders.card.disableCloudSync", "folders.card.deleteFolder",
  ]);
  expect(panel.map((i) => i.label)).toEqual(card.map((i) => i.label).filter((l) => l !== "rename" && l !== "edit"));
});
