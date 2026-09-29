import { test, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/teamObjects", () => ({
  createRuleSet: vi.fn(async () => "sDefault"),
  putRuleSet: vi.fn(async () => {}),
}));

vi.mock("@/services/teamObjectPersistence", () => ({
  saveTeamVaultObject: vi.fn(async () => {}),
  findTeamItem: vi.fn(async (_teamId: string, _type: string, id: string) => ({ id })),
}));

import { createRuleSet, putRuleSet } from "@/services/teamObjects";
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

beforeEach(() => {
  vi.clearAllMocks();
  useTeamObjectAccessStore.getState().clearAll();
  useTeamObjectAccessStore.getState().replaceTeam("t1", tree, true);
});

test("an object with its own set is edited in place", async () => {
  await saveObjectRules({ teamId: "t1", objectId: "cOwn", type: "connection" }, everyoneDenyView);
  expect(putRuleSet).toHaveBeenCalledWith("t1", "sOwn", everyoneDenyView);
  expect(saveTeamVaultObject).not.toHaveBeenCalled();
});

test("a synced object is un-synced onto a new set", async () => {
  vi.mocked(createRuleSet).mockResolvedValueOnce("sNew");
  await saveObjectRules({ teamId: "t1", objectId: "cSynced", type: "connection" }, everyoneDenyView);
  expect(createRuleSet).toHaveBeenCalledWith("t1", everyoneDenyView);
  expect(saveTeamVaultObject).toHaveBeenCalledWith("t1", "connection", { id: "cSynced" }, { ruleSetId: "sNew" });
});

test("a folder that owns its set edits it for everything synced with it", async () => {
  await saveObjectRules({ teamId: "t1", objectId: "fA", type: "folder" }, everyoneDenyView);
  expect(putRuleSet).toHaveBeenCalledWith("t1", "sA", everyoneDenyView);
});

test("a subfolder synced with its parent is un-synced, not its parent's set edited", async () => {
  vi.mocked(createRuleSet).mockResolvedValueOnce("sSub");
  await saveObjectRules({ teamId: "t1", objectId: "fSub", type: "folder" }, everyoneDenyView);
  expect(putRuleSet).not.toHaveBeenCalled();
  expect(saveTeamVaultObject).toHaveBeenCalledWith("t1", "folder", { id: "fSub" }, { ruleSetId: "sSub" });
});

test("an object moved out without Manage still shares its old folder's set, so editing it forks", async () => {
  useTeamObjectAccessStore.getState().replaceTeam("t1", { ...tree, cMoved: e({ ruleSetId: "sA", parentId: "fB" }) }, true);
  vi.mocked(createRuleSet).mockResolvedValueOnce("sFork");
  await saveObjectRules({ teamId: "t1", objectId: "cMoved", type: "connection" }, everyoneDenyView);
  expect(putRuleSet).not.toHaveBeenCalled();
  expect(saveTeamVaultObject).toHaveBeenCalledWith("t1", "connection", { id: "cMoved" }, { ruleSetId: "sFork" });
});

test("a folder whose set is shared outside its synced subtree forks instead of editing it", async () => {
  useTeamObjectAccessStore.getState().replaceTeam("t1", { ...tree, cMoved: e({ ruleSetId: "sA", parentId: "fB" }) }, true);
  vi.mocked(createRuleSet).mockResolvedValueOnce("sFork");
  await saveObjectRules({ teamId: "t1", objectId: "fA", type: "folder" }, everyoneDenyView);
  expect(putRuleSet).not.toHaveBeenCalled();
  expect(saveTeamVaultObject).toHaveBeenCalledWith("t1", "folder", { id: "fA" }, { ruleSetId: "sFork" });
});

test("Sync now points back at the parent's set", async () => {
  await syncWithFolder({ teamId: "t1", objectId: "cOwn", type: "connection" });
  expect(saveTeamVaultObject).toHaveBeenCalledWith("t1", "connection", { id: "cOwn" }, { ruleSetId: "sA" });
});
