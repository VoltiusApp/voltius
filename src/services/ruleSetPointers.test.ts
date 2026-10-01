import { test, expect } from "vitest";
import { isUnresolvedParent, pointerForSave, setOfParent, isSynced, syncedSubtree } from "./ruleSetPointers";
import type { ObjectAccess, TeamAccessEntries } from "@/stores/teamObjectAccessStore";
import { PERM_BITS } from "./permissions";

const MANAGE = PERM_BITS.VIEW | PERM_BITS.MANAGE_ROLES;
const e = (over: Partial<ObjectAccess>): ObjectAccess => ({
  type: "connection", ruleSetId: null, myPermissions: MANAGE, parentId: null, deleted: false, ...over,
});
const tree: TeamAccessEntries = {
  fA: e({ type: "folder", ruleSetId: "sA" }),
  fB: e({ type: "folder", ruleSetId: "sB" }),
  fTrashed: e({ type: "folder", ruleSetId: "sT", deleted: true }),
  fSub: e({ type: "folder", ruleSetId: "sA", parentId: "fA" }),
  cSynced: e({ ruleSetId: "sA", parentId: "fA" }),
  cOwn: e({ ruleSetId: "sOwn", parentId: "fA" }),
  cDeep: e({ ruleSetId: "sA", parentId: "fSub" }),
  cGone: e({ ruleSetId: "sA", parentId: "fA", deleted: true }),
  cLocked: e({ ruleSetId: "sA", parentId: "fA", myPermissions: PERM_BITS.VIEW | PERM_BITS.EDIT_CONNECTIONS }),
};
const at = (objectId: string, nextParentId: string | null, canManageAtRoot = true) =>
  pointerForSave({ entries: tree, objectId, nextParentId, canManageAtRoot });

test("a new object takes its folder's set, or team-wide at the root", () => {
  expect(at("new", "fB")).toBe("sB");
  expect(at("new", null)).toBeNull();
});

test("a new object in a hidden or deleted folder sends no pointer", () => {
  expect(at("new", "hiddenFolder")).toBeUndefined();
  expect(at("new", "fTrashed")).toBeUndefined();
});

test("a parent is unresolved when unknown or deleted, never at the root", () => {
  expect(isUnresolvedParent(tree, "hiddenFolder")).toBe(true);
  expect(isUnresolvedParent(tree, "fTrashed")).toBe(true);
  expect(isUnresolvedParent(tree, "fA")).toBe(false);
  expect(isUnresolvedParent(tree, null)).toBe(false);
});

test("an edit that does not move keeps the pointer", () => {
  expect(at("cSynced", "fA")).toBeUndefined();
});

test("a synced object moving to a folder with another set takes that set", () => {
  expect(at("cSynced", "fB")).toBe("sB");
  expect(at("cSynced", null)).toBeNull();
});

test("an un-synced object keeps its own set wherever it goes", () => {
  expect(at("cOwn", "fB")).toBeUndefined();
});

test("a mover without Manage keeps the current set", () => {
  expect(at("cLocked", "fB")).toBeUndefined();
  expect(at("cSynced", null, false)).toBeUndefined();
});

test("an object moved into a hidden or deleted folder keeps its pointer", () => {
  expect(at("cSynced", "hiddenFolder")).toBeUndefined();
  expect(at("cSynced", "fTrashed")).toBeUndefined();
});

test("an undo restore of a deleted object never repoints", () => {
  expect(at("cGone", "fB")).toBeUndefined();
});

test("synced helpers", () => {
  expect(setOfParent(tree, "fA")).toBe("sA");
  expect(isSynced(tree, "cSynced")).toBe(true);
  expect(isSynced(tree, "cOwn")).toBe(false);
  expect(syncedSubtree(tree, "fA").sort()).toEqual(["cDeep", "cLocked", "cSynced", "fSub"]);
});
