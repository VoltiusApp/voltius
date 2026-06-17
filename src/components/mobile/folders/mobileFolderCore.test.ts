// src/components/mobile/folders/mobileFolderCore.test.ts
import { buildMoveTargets, scopeItems, folderItemCount, type FolderLike } from "./mobileFolderCore.ts";

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
  console.log(`PASS ${msg}`);
}

const folders: FolderLike[] = [
  { id: "a", name: "Beta", object_type: "connection", parent_folder_id: undefined },
  { id: "b", name: "Alpha", object_type: "connection", parent_folder_id: undefined },
  { id: "c", name: "Child", object_type: "connection", parent_folder_id: "b" },
  { id: "x", name: "Other", object_type: "keychain", parent_folder_id: undefined },
];

// buildMoveTargets: only matching object_type, root entry first, depth-first, alpha within a level
{
  const t = buildMoveTargets(folders, "connection");
  assertEqual(t, [
    { id: null, name: "No folder", depth: 0 },
    { id: "b", name: "Alpha", depth: 0 },
    { id: "c", name: "Child", depth: 1 },
    { id: "a", name: "Beta", depth: 0 },
  ], "buildMoveTargets nests + sorts + root entry");
}

// scopeItems: only items at the given folder (null === root)
{
  const items = [
    { id: "1", folder_id: undefined },
    { id: "2", folder_id: "b" },
    { id: "3", folder_id: null },
  ];
  assertEqual(scopeItems(items, null).map((i) => i.id), ["1", "3"], "scopeItems root");
  assertEqual(scopeItems(items, "b").map((i) => i.id), ["2"], "scopeItems folder");
}

// folderItemCount
{
  const items = [{ folder_id: "b" }, { folder_id: "b" }, { folder_id: "a" }];
  assertEqual(folderItemCount(items, "b"), 2, "folderItemCount");
}
