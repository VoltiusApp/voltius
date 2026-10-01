import { test, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/teamObjects", () => ({
  createRuleSet: vi.fn(async () => "sDefault"),
  getRuleSet: vi.fn(async () => ({ entries: [], updatedAt: "t0" })),
  putRuleSet: vi.fn(async () => {}),
}));

vi.mock("@/services/teamObjectPersistence", () => ({
  saveTeamVaultObject: vi.fn(async () => {}),
  findTeamItem: vi.fn(async (_teamId: string, _type: string, id: string) => ({ id })),
}));

import { createRuleSet, getRuleSet, putRuleSet } from "@/services/teamObjects";
import { saveTeamVaultObject } from "@/services/teamObjectPersistence";
import { useTeamObjectAccessStore, type ObjectAccess, type TeamAccessEntries } from "@/stores/teamObjectAccessStore";
import { PERM_BITS } from "@/services/permissions";
import { saveObjectRules, syncWithFolder } from "./ruleSetEditing";

const MANAGE = PERM_BITS.VIEW | PERM_BITS.MANAGE_ROLES;
const e = (over: Partial<ObjectAccess>): ObjectAccess => ({
  type: "connection", ruleSetId: null, myPermissions: MANAGE, parentId: null, deleted: false, ...over,
});
const tree: TeamAccessEntries = {
  fA: e({ type: "folder", ruleSetId: "sA" }),
  fB: e({ type: "folder", ruleSetId: "sB" }),
  fSub: e({ type: "folder", ruleSetId: "sA", parentId: "fA" }),
  cSynced: e({ ruleSetId: "sA", parentId: "fA" }),
  cOwn: e({ ruleSetId: "sOwn", parentId: "fA" }),
  cDeep: e({ ruleSetId: "sA", parentId: "fSub" }),
  cGone: e({ ruleSetId: "sA", parentId: "fA", deleted: true }),
  cLocked: e({ ruleSetId: "sA", parentId: "fA", myPermissions: PERM_BITS.VIEW | PERM_BITS.EDIT_CONNECTIONS }),
};

const everyoneDenyView = [{ subject_type: "everyone" as const, subject_id: null, allow: 0, deny: PERM_BITS.VIEW }];
const denyView = () => everyoneDenyView;
const theirs = { subject_type: "member" as const, subject_id: "u9", allow: PERM_BITS.CONNECT, deny: 0 };
const cOwn = { teamId: "t1", objectId: "cOwn", type: "connection" as const };
const conflict = () => Object.assign(new Error("conflict"), { status: 409 });

beforeEach(() => {
  vi.clearAllMocks();
  useTeamObjectAccessStore.getState().clearAll();
  useTeamObjectAccessStore.getState().replaceTeam("t1", tree, true);
});

test("an object with its own set is edited in place", async () => {
  await saveObjectRules(cOwn, denyView);
  expect(putRuleSet).toHaveBeenCalledWith("t1", "sOwn", everyoneDenyView, "t0");
  expect(saveTeamVaultObject).not.toHaveBeenCalled();
});

test("a synced object is un-synced onto a new set", async () => {
  vi.mocked(createRuleSet).mockResolvedValueOnce("sNew");
  await saveObjectRules({ teamId: "t1", objectId: "cSynced", type: "connection" }, denyView);
  expect(createRuleSet).toHaveBeenCalledWith("t1", everyoneDenyView);
  expect(saveTeamVaultObject).toHaveBeenCalledWith("t1", "connection", { id: "cSynced" }, { ruleSetId: "sNew" });
});

test("a folder that owns its set edits it for everything synced with it", async () => {
  await saveObjectRules({ teamId: "t1", objectId: "fA", type: "folder" }, denyView);
  expect(putRuleSet).toHaveBeenCalledWith("t1", "sA", everyoneDenyView, "t0");
});

test("a subfolder synced with its parent is un-synced, not its parent's set edited", async () => {
  vi.mocked(createRuleSet).mockResolvedValueOnce("sSub");
  await saveObjectRules({ teamId: "t1", objectId: "fSub", type: "folder" }, denyView);
  expect(putRuleSet).not.toHaveBeenCalled();
  expect(saveTeamVaultObject).toHaveBeenCalledWith("t1", "folder", { id: "fSub" }, { ruleSetId: "sSub" });
});

test("an object moved out without Manage still shares its old folder's set, so editing it forks", async () => {
  useTeamObjectAccessStore.getState().replaceTeam("t1", { ...tree, cMoved: e({ ruleSetId: "sA", parentId: "fB" }) }, true);
  vi.mocked(createRuleSet).mockResolvedValueOnce("sFork");
  await saveObjectRules({ teamId: "t1", objectId: "cMoved", type: "connection" }, denyView);
  expect(putRuleSet).not.toHaveBeenCalled();
  expect(saveTeamVaultObject).toHaveBeenCalledWith("t1", "connection", { id: "cMoved" }, { ruleSetId: "sFork" });
});

test("a folder whose set is shared outside its synced subtree forks instead of editing it", async () => {
  useTeamObjectAccessStore.getState().replaceTeam("t1", { ...tree, cMoved: e({ ruleSetId: "sA", parentId: "fB" }) }, true);
  vi.mocked(createRuleSet).mockResolvedValueOnce("sFork");
  await saveObjectRules({ teamId: "t1", objectId: "fA", type: "folder" }, denyView);
  expect(putRuleSet).not.toHaveBeenCalled();
  expect(saveTeamVaultObject).toHaveBeenCalledWith("t1", "folder", { id: "fA" }, { ruleSetId: "sFork" });
});

test("an edit is applied to the server's current entries, not the caller's copy", async () => {
  vi.mocked(getRuleSet).mockResolvedValueOnce({ entries: [theirs], updatedAt: "t1" });
  const saved = await saveObjectRules(cOwn, (entries) => [...entries, ...everyoneDenyView]);
  expect(saved).toEqual([theirs, ...everyoneDenyView]);
  expect(putRuleSet).toHaveBeenCalledWith("t1", "sOwn", [theirs, ...everyoneDenyView], "t1");
});

test("a synced object forks from its folder's current entries", async () => {
  vi.mocked(getRuleSet).mockResolvedValueOnce({ entries: everyoneDenyView, updatedAt: "t1" });
  await saveObjectRules({ teamId: "t1", objectId: "cSynced", type: "connection" }, (entries) => entries.map((e) => ({ ...e, allow: PERM_BITS.CONNECT })));
  expect(getRuleSet).toHaveBeenCalledWith("t1", "sA");
  expect(createRuleSet).toHaveBeenCalledWith("t1", [{ ...everyoneDenyView[0], allow: PERM_BITS.CONNECT }]);
});

test("a conflicting save re-reads the set and reapplies the edit", async () => {
  vi.mocked(getRuleSet)
    .mockResolvedValueOnce({ entries: [], updatedAt: "t1" })
    .mockResolvedValueOnce({ entries: [theirs], updatedAt: "t2" });
  vi.mocked(putRuleSet).mockRejectedValueOnce(conflict());
  await saveObjectRules(cOwn, (entries) => [...entries, ...everyoneDenyView]);
  expect(putRuleSet).toHaveBeenCalledTimes(2);
  expect(putRuleSet).toHaveBeenLastCalledWith("t1", "sOwn", [theirs, ...everyoneDenyView], "t2");
});

test("a save that keeps conflicting gives up with the conflict", async () => {
  for (let i = 0; i < 4; i++) vi.mocked(putRuleSet).mockRejectedValueOnce(conflict());
  await expect(saveObjectRules(cOwn, denyView)).rejects.toMatchObject({ status: 409 });
  expect(putRuleSet).toHaveBeenCalledTimes(4);
});

test("Sync now points back at the parent's set", async () => {
  await syncWithFolder(cOwn);
  expect(saveTeamVaultObject).toHaveBeenCalledWith("t1", "connection", { id: "cOwn" }, { ruleSetId: "sA" });
});
