// src/components/mobile/folders/mobileFolderCore.test.ts
import { buildMoveTargets, scopeItems, type FolderLike } from "./mobileFolderCore.ts";
import { test, expect } from "vitest";

test("mobileFolderCore", async () => {
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
}

const folders: FolderLike[] = [
  { id: "a", name: "Beta", object_type: "connection", parent_folder_id: undefined },
  { id: "b", name: "Alpha", object_type: "connection", parent_folder_id: undefined },
  { id: "c", name: "Child", object_type: "connection", parent_folder_id: "b" },
  { id: "x", name: "Other", object_type: "keychain", parent_folder_id: undefined },
];

// buildMoveTargets: only matching object_type, root entry first, depth-first, alpha within a level
{
  const t = buildMoveTargets(folders, "connection", "personal");
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
});

test("mobile root shows items and folders filed under a hidden folder", () => {
  const folders = [{ id: "f1", name: "F", object_type: "connection" }, { id: "f2", name: "G", object_type: "connection", parent_folder_id: "hidden" }];
  expect(buildMoveTargets(folders, "connection", "personal").map((t) => t.id)).toEqual([null, "f1", "f2"]);
  expect(scopeItems([{ folder_id: "hidden" }, { folder_id: "f1" }], null, new Set(["f1", "f2"])))
    .toEqual([{ folder_id: "hidden" }]);
});

test("move targets never offer a folder from another vault", () => {
  const folders = [
    { id: "p", name: "Mine", object_type: "connection" },
    { id: "t", name: "Team", object_type: "connection", vault_id: "team-1" },
  ];
  expect(buildMoveTargets(folders, "connection", "team-1").map((t) => t.id)).toEqual([null, "t"]);
  expect(buildMoveTargets(folders, "connection", "personal").map((t) => t.id)).toEqual([null, "p"]);
});
