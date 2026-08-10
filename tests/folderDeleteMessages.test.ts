import { test, expect } from "vitest";
import type { TFunction } from "i18next";
import type { Folder } from "@/types";
import { folderDeleteMessages } from "@/utils/folderDeleteMessages";

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key) as unknown as TFunction;

function folder(id: string): Folder {
  return { id, name: id, object_type: "connection", vault_id: "personal", created_at: "", updated_at: "", clocks: {} } as Folder;
}

const tree: Record<string, string[]> = { "f-full": ["a", "b"], "f-empty": [] };

function make() {
  return folderDeleteMessages({
    t,
    prefix: "hosts.page",
    folders: [folder("f-full"), folder("f-empty")],
    itemIdsInFolderTree: (id) => tree[id] ?? [],
  });
}

test("a folder holding nothing gets the empty message, with no count", () => {
  expect(make().folderDeleteMessage("f-empty")).toBe("hosts.page.confirmDeleteFolder.messageEmpty");
});

test("a folder's delete message counts everything nested under it", () => {
  expect(make().folderDeleteMessage("f-full")).toBe('hosts.page.confirmDeleteFolder.message:{"count":2}');
});

test("a selection of plain items says nothing about a cascade", () => {
  expect(make().bulkDeleteMessage(["a", "b"])).toBe('hosts.page.confirmDelete.message:{"count":2}');
});

test("a selected folder appends the count of what goes down with it", () => {
  expect(make().bulkDeleteMessage(["f-full"])).toBe(
    'hosts.page.confirmDelete.message:{"count":1} hosts.page.confirmDelete.folderCascade:{"count":2}',
  );
});

test("an item selected in its own right is not also counted as cascaded", () => {
  expect(make().bulkDeleteMessage(["f-full", "a", "b"])).toBe('hosts.page.confirmDelete.message:{"count":3}');
});

test("an id that is not a folder contributes no cascade even if the tree knows it", () => {
  expect(make().bulkDeleteMessage(["a"])).toBe('hosts.page.confirmDelete.message:{"count":1}');
});
