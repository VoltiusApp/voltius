import { test, expect } from "vitest";
import { nameIsFree, folderNameIsFree } from "./cloneName";

const host = (name: string, vault_id = "personal", folder_id: string | null = null) => ({
  name,
  vault_id,
  folder_id,
});

test("a name nothing else uses is free", () => {
  expect(nameIsFree([host("web-1")], "web-2", "personal", null)).toBe(true);
});

test("the same name in the same vault and folder is taken", () => {
  expect(nameIsFree([host("web-1")], "web-1", "personal", null)).toBe(false);
});

// The point of the whole rule: the original is not in the destination vault, so
// the clone is not a copy of anything visible there.
test("the same name in another vault is free", () => {
  expect(nameIsFree([host("web-1")], "web-1", "team-1", null)).toBe(true);
});

test("the same name in another folder of the same vault is free", () => {
  expect(nameIsFree([host("web-1", "personal", "f1")], "web-1", "personal", null)).toBe(true);
});

// Absent vault_id means the personal vault, so it must still collide there.
test("a missing vault_id counts as personal", () => {
  expect(nameIsFree([{ name: "web-1" }], "web-1", "personal", null)).toBe(false);
});

test("an unnamed object never collides", () => {
  expect(nameIsFree([host("web-1")], undefined, "personal", null)).toBe(true);
});

test("folders collide on vault and parent, not folder", () => {
  const folders = [{ name: "Prod", vault_id: "personal", parent_folder_id: null }];
  expect(folderNameIsFree(folders, "Prod", "personal", null)).toBe(false);
  expect(folderNameIsFree(folders, "Prod", "team-1", null)).toBe(true);
  expect(folderNameIsFree(folders, "Prod", "personal", "f1")).toBe(true);
});
