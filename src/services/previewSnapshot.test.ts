import { test, expect, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { previewSnapshot, PREVIEW_ROLE_USER_ID } from "./previewSnapshot";
import { PERM_BITS, resolveCan, type Permission, type PermissionSnapshot } from "@/services/permissions";
import type { Preview, PreviewResponse } from "@/services/permissionPreview";
import type { Vault } from "@/stores/vaultStore";
import type { ObjectAccess } from "@/stores/teamObjectAccessStore";
import { makeMember, makeRole, makeTeam } from "@/test/team";

const { VIEW, CONNECT, EDIT_CONNECTIONS, EDIT_SNIPPETS } = PERM_BITS;

const access = (myPermissions: number): ObjectAccess =>
  ({ type: "connection", ruleSetId: null, myPermissions, parentId: null, deleted: false });
const preview = (objects: Record<string, number>, team_bits = 0): Preview => ({
  team_bits,
  objects: Object.fromEntries(Object.entries(objects).map(([id, mask]) => [id, { mask, rule_set_id: null }])),
  rule_sets: {},
  holds_vault_key_gate: true,
});
const response = (current: Preview, draft: Preview | null = null): PreviewResponse =>
  ({ locked: false, current, draft, affected: null });

const base: PermissionSnapshot = {
  myUserId: "admin",
  teams: [makeTeam("t1"), makeTeam("t2")],
  membersByTeam: { t1: [makeMember("admin", ["admin-role"]), makeMember("bob", ["viewer"])], t2: [makeMember("admin", ["admin-role"])] },
  rolesByTeam: { t1: [makeRole("admin-role", -1 >>> 1), makeRole("viewer", VIEW), makeRole("editor", VIEW | EDIT_CONNECTIONS)] },
  vaults: [{ id: "v1", teamId: "t1" } as Vault],
  objectAccess: { t1: { c1: access(0xffff), c2: access(0xffff) }, t2: { x: access(VIEW) } },
};

const can = (s: PermissionSnapshot, permission: Permission, objectId?: string) => resolveCan(s, permission, "v1", objectId);
const memberSession = { teamId: "t1", vaultId: "v1", subject: { type: "member" as const, user_id: "bob" } };

test("member_subject_uses_draft_masks_and_preview_object_masks", () => {
  const draft = { role_ids: ["editor"], allow: 0, deny: 0 };
  const s = previewSnapshot(base, memberSession, draft, response(preview({ c1: VIEW }), preview({ c1: VIEW | CONNECT }, VIEW | EDIT_SNIPPETS)));

  expect(s.myUserId).toBe("bob");
  expect(s.membersByTeam.t1.find((m) => m.user_id === "bob")?.role_ids).toEqual(["editor"]);
  expect(can(s, "CONNECT", "c1")).toBe(true);
  expect(can(s, "EDIT_SNIPPETS")).toBe(true);
  expect(can(s, "EDIT_CONNECTIONS")).toBe(false);
  expect(s.objectAccess?.t2).toBe(base.objectAccess?.t2);
  expect(s.membersByTeam.t2).toBe(base.membersByTeam.t2);
  expect(s.teamBits?.t2).toBeUndefined();
});

test("role_subject_gets_a_synthetic_member_with_the_drafted_role_bits", () => {
  const session = { teamId: "t1", vaultId: "v1", subject: { type: "role" as const, role_id: "viewer" } };
  const s = previewSnapshot(base, session, { permissions: VIEW | EDIT_SNIPPETS }, response(preview({}), preview({}, VIEW | EDIT_SNIPPETS)));

  expect(s.myUserId).toBe(PREVIEW_ROLE_USER_ID);
  expect(s.membersByTeam.t1.find((m) => m.user_id === PREVIEW_ROLE_USER_ID)?.role_ids).toEqual(["viewer"]);
  expect(s.rolesByTeam.t1.find((r) => r.id === "viewer")?.permissions).toBe(VIEW | EDIT_SNIPPETS);
  expect(can(s, "EDIT_SNIPPETS")).toBe(true);
  expect(can(s, "EDIT_CONNECTIONS")).toBe(false);
  expect(base.rolesByTeam.t1.find((r) => r.id === "viewer")?.permissions).toBe(VIEW);
});

test("objects_missing_from_the_preview_fall_back_to_team_level", () => {
  const s = previewSnapshot(base, memberSession, null, response(preview({ c1: 0 }, VIEW)));

  expect(s.objectAccess?.t1.c1.myPermissions).toBe(0);
  expect(s.objectAccess?.t1.c2).toBeUndefined();
  expect(can(s, "VIEW", "c1")).toBe(false);
  expect(can(s, "VIEW", "c2")).toBe(true);
  expect(can(s, "EDIT_CONNECTIONS", "c2")).toBe(false);
});
