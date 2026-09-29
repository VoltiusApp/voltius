import { test, expect, beforeEach } from "vitest";
import { buildAccessEntries, parentIdOf } from "./teamObjectAccess";
import {
  useTeamObjectAccessStore, objectAccess, ruleSetsSupported,
} from "@/stores/teamObjectAccessStore";
import type { TeamObjectRecord } from "./teamObjects";

const row = (id: string, over: Partial<TeamObjectRecord> = {}): TeamObjectRecord => ({
  object_id: id, object_type: "connection", metadata: {}, updated_at: "", updated_by: "u",
  rule_set_id: null, my_permissions: 7, ...over,
});

beforeEach(() => useTeamObjectAccessStore.getState().clearAll());

test("parentIdOf reads folder_id for objects and parent_folder_id for folders", () => {
  expect(parentIdOf({ folder_id: "f1" })).toBe("f1");
  expect(parentIdOf({ parent_folder_id: "f2" })).toBe("f2");
  expect(parentIdOf({})).toBeNull();
});

test("live rows carry mask, set and parent; deleted rows become tombstones", () => {
  const { entries, supported } = buildAccessEntries(
    [row("c1", { rule_set_id: "s1" }), row("c2", { deleted_at: "2026-09-28T00:00:00Z" })],
    new Map([["c1", { id: "c1", folder_id: "f1" }]]),
  );
  expect(supported).toBe(true);
  expect(entries.c1).toEqual({ type: "connection", ruleSetId: "s1", myPermissions: 7, parentId: "f1", deleted: false });
  expect(entries.c2).toMatchObject({ deleted: true, ruleSetId: null });
});

test("a live row that failed to decode gets no entry", () => {
  expect(buildAccessEntries([row("c1")], new Map()).entries.c1).toBeUndefined();
});

test("rows without my_permissions mean an older server", () => {
  const { supported } = buildAccessEntries([row("c1", { my_permissions: undefined })], new Map([["c1", {}]]));
  expect(supported).toBe(false);
});

test("an empty list says nothing about support", () => {
  expect(buildAccessEntries([], new Map()).supported).toBeNull();
});

test("store helpers", () => {
  const s = useTeamObjectAccessStore.getState();
  s.replaceTeam("t1", { c1: { type: "connection", ruleSetId: "s1", myPermissions: 1, parentId: null, deleted: false } }, true);
  expect(objectAccess("t1", "c1")?.ruleSetId).toBe("s1");
  expect(ruleSetsSupported("t1")).toBe(true);
  s.clearTeam("t1");
  expect(objectAccess("t1", "c1")).toBeUndefined();
  expect(ruleSetsSupported("t1")).toBe(false);
});
