import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ sent: [] as Record<string, unknown>[] }));

vi.mock("@/services/teamObjects", () => ({
  upsertTeamObject: vi.fn(async (_teamId: string, object: Record<string, unknown>) => {
    h.sent.push(object);
  }),
  deleteTeamObject: vi.fn(async () => {}),
  copyRuleSet: vi.fn(async () => "sCopy"),
}));

vi.mock("@/services/teamObjectEnvelope", () => ({
  encodeObjectMetadata: vi.fn(async (_teamId: string, item: object) => ({
    v: 2 as const,
    enc: JSON.stringify(item),
  })),
}));

vi.mock("@/services/permissionsFromStores", () => ({
  canFromStoresAsync: async () => () => true,
}));

vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: { getState: () => ({ teamConnections: { t1: [{ id: "cDeep", folder_id: "fSub" }] } }) },
}));

vi.mock("@/stores/folderStore", () => ({
  useFolderStore: { getState: () => ({ teamFolders: { t1: [{ id: "fSub", parent_folder_id: "fA" }] } }) },
}));

import { copyRuleSet, upsertTeamObject } from "@/services/teamObjects";
import { objectAccess, useTeamObjectAccessStore, type ObjectAccess, type TeamAccessEntries } from "@/stores/teamObjectAccessStore";
import { PERM_BITS } from "./permissions";
import {
  RuleSetMoveCancelled, passMoveCancelled, removeTeamVaultObject, revertIfMoveCancelled, saveTeamVaultObject, setRuleSetMoveConfirmer,
} from "./teamObjectPersistence";

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

beforeEach(() => {
  vi.clearAllMocks();
  h.sent = [];
  useTeamObjectAccessStore.getState().clearAll();
  useTeamObjectAccessStore.getState().replaceTeam("t1", tree, true);
  setRuleSetMoveConfirmer(async () => true);
});

const sent = () => vi.mocked(upsertTeamObject).mock.calls.map(([, body]) => body);

test("sends an encrypted envelope and no plaintext name or folder id", async () => {
  await saveTeamVaultObject("t1", "connection", {
    id: "c1",
    name: "prod-db-master",
    folder_id: "f7",
    host: "10.0.0.1",
  } as never);

  expect(h.sent).toHaveLength(1);
  const sent = h.sent[0];
  expect(sent.object_id).toBe("c1");
  expect(sent.object_type).toBe("connection");
  expect(sent.name).toBeNull();
  expect(sent.folder_id).toBeNull();
  expect(sent.metadata).toEqual({ v: 2, enc: expect.any(String) });
  // The mock's `enc` is a passthrough JSON.stringify(item), so the plaintext
  // legitimately appears *inside* the envelope. What must never happen is the
  // plaintext appearing anywhere else in the request (e.g. name/folder_id).
  expect(JSON.stringify({ ...sent, metadata: undefined })).not.toContain("prod-db-master");
});

test("create inside a folder sends the folder's set", async () => {
  await saveTeamVaultObject("t1", "connection", { id: "new", folder_id: "fB" });
  expect(sent()[0].rule_set_id).toBe("sB");
});

test("an older server never receives rule_set_id", async () => {
  useTeamObjectAccessStore.getState().clearTeam("t1");
  await saveTeamVaultObject("t1", "connection", { id: "new", folder_id: "fB" });
  expect(sent()[0].rule_set_id).toBeUndefined();
});

test("a plain edit omits the key", async () => {
  await saveTeamVaultObject("t1", "connection", { id: "cSynced", folder_id: "fA" });
  expect(sent()[0].rule_set_id).toBeUndefined();
});

test("undo restore of a deleted restricted object keeps its pointer", async () => {
  await removeTeamVaultObject("t1", "cSynced");
  expect(objectAccess("t1", "cSynced")?.deleted).toBe(true);
  await saveTeamVaultObject("t1", "connection", { id: "cSynced", folder_id: "fB" });
  expect(sent()[0].rule_set_id).toBeUndefined();
});

test("restoring a deleted object on its own set sends no rule_set_id and copies nothing", async () => {
  await removeTeamVaultObject("t1", "cOwn");
  await saveTeamVaultObject("t1", "connection", { id: "cOwn", folder_id: "fA" });
  expect(sent()[0].rule_set_id).toBeUndefined();
  expect(copyRuleSet).not.toHaveBeenCalled();
  expect(objectAccess("t1", "cOwn")).toMatchObject({ ruleSetId: "sOwn", deleted: false });
});

test("a synced move asks, then repoints and records the new set", async () => {
  const confirm = vi.fn(async () => true);
  setRuleSetMoveConfirmer(confirm);
  await saveTeamVaultObject("t1", "connection", { id: "cSynced", folder_id: "fB" });
  expect(confirm).toHaveBeenCalledWith("t1", "sA", "sB");
  expect(sent()[0].rule_set_id).toBe("sB");
  expect(objectAccess("t1", "cSynced")).toMatchObject({ ruleSetId: "sB", parentId: "fB" });
});

test("a mover without Manage keeps the current set and is not asked", async () => {
  const confirm = vi.fn(async () => true);
  setRuleSetMoveConfirmer(confirm);
  await saveTeamVaultObject("t1", "connection", { id: "cLocked", folder_id: "fB" });
  expect(confirm).not.toHaveBeenCalled();
  expect(sent()[0].rule_set_id).toBeUndefined();
});

test("cancelling the move writes nothing", async () => {
  setRuleSetMoveConfirmer(async () => false);
  await expect(saveTeamVaultObject("t1", "connection", { id: "cSynced", folder_id: "fB" }))
    .rejects.toBeInstanceOf(RuleSetMoveCancelled);
  expect(upsertTeamObject).not.toHaveBeenCalled();
});

test("a lost create race retries without the pointer", async () => {
  vi.mocked(upsertTeamObject).mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 }));
  await saveTeamVaultObject("t1", "connection", { id: "new", folder_id: "fB" });
  expect(sent()[1].rule_set_id).toBeUndefined();
});

test("moving a synced folder carries its synced subtree", async () => {
  setRuleSetMoveConfirmer(async () => true);
  await saveTeamVaultObject("t1", "folder", { id: "fSub", parent_folder_id: "fB" });
  const ids = sent().map((b) => [b.object_id, b.rule_set_id]);
  expect(ids).toEqual([["fSub", "sB"], ["cDeep", "sB"]]);
});

test("a duplicate copies an un-synced source's set and follows the folder otherwise", async () => {
  await saveTeamVaultObject("t1", "connection", { id: "dup1", folder_id: "fB" }, { rulesFrom: "cOwn" });
  await saveTeamVaultObject("t1", "connection", { id: "dup2", folder_id: "fB" }, { rulesFrom: "cSynced" });
  expect(copyRuleSet).toHaveBeenCalledExactlyOnceWith("t1", "sOwn");
  expect(sent().map((b) => b.rule_set_id)).toEqual(["sCopy", "sB"]);
});

test("duplicating an un-synced object copies its own set server-side", async () => {
  vi.mocked(copyRuleSet).mockResolvedValueOnce("sCopy");
  await saveTeamVaultObject("t1", "connection", { id: "dup", folder_id: "fA" }, { rulesFrom: "cOwn" });
  expect(copyRuleSet).toHaveBeenCalledWith("t1", "sOwn");
  expect(sent()[0].rule_set_id).toBe("sCopy");
});

test("duplicating a synced object syncs the copy with its destination", async () => {
  await saveTeamVaultObject("t1", "connection", { id: "dup", folder_id: "fB" }, { rulesFrom: "cSynced" });
  expect(copyRuleSet).not.toHaveBeenCalled();
  expect(sent()[0].rule_set_id).toBe("sB");
});

test("a save handler reports real failures but hands a cancelled move back to the editor", () => {
  const report = vi.fn();
  passMoveCancelled(report)(new Error("boom"));
  expect(report).toHaveBeenCalledTimes(1);
  expect(() => passMoveCancelled(report)(new RuleSetMoveCancelled())).toThrow(RuleSetMoveCancelled);
  expect(report).toHaveBeenCalledTimes(1);
});

test("a cancelled move reverts, any other failure still propagates", () => {
  const revert = vi.fn();
  revertIfMoveCancelled(revert)(new RuleSetMoveCancelled());
  expect(revert).toHaveBeenCalledTimes(1);
  expect(() => revertIfMoveCancelled(revert)(new Error("boom"))).toThrow("boom");
  expect(revert).toHaveBeenCalledTimes(1);
});
