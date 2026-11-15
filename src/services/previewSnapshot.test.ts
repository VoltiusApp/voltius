import { test, expect, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { previewSnapshot, PREVIEW_ROLE_USER_ID } from "./previewSnapshot";
import { PERM_BITS, resolveCan, type PermissionSnapshot } from "@/services/permissions";
import type { Preview, PreviewResponse } from "@/services/permissionPreview";
import type { Team, TeamMember, TeamRole } from "@/services/teamService";
import type { Vault } from "@/stores/vaultStore";
import type { ObjectAccess } from "@/stores/teamObjectAccessStore";

const { VIEW, CONNECT, EDIT_CONNECTIONS, EDIT_SNIPPETS } = PERM_BITS;

const team = { id: "t1", name: "T", owner_id: "admin", owner_tier: "business", created_at: "", role_ids: [] } as Team;
const role = (id: string, permissions: number): TeamRole =>
  ({ id, team_id: "t1", name: id, permissions, is_builtin: false, position: 1, created_at: "" });
const member = (user_id: string, role_ids: string[]): TeamMember =>
  ({ team_id: "t1", user_id, invited_by_display_name: null, joined_at: "", public_key: "", role_ids });
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
  teams: [team, { ...team, id: "t2" }],
  membersByTeam: { t1: [member("admin", ["admin-role"]), member("bob", ["viewer"])], t2: [member("admin", ["admin-role"])] },
  rolesByTeam: { t1: [role("admin-role", -1 >>> 1), role("viewer", VIEW), role("editor", VIEW | EDIT_CONNECTIONS)] },
  vaults: [{ id: "v1", teamId: "t1" } as Vault],
  objectAccess: { t1: { c1: access(0xffff), c2: access(0xffff) }, t2: { x: access(VIEW) } },
};

const can = (s: PermissionSnapshot, bit: Parameters<typeof resolveCan>[1], objectId?: string) =>
  resolveCan(s, bit, "v1", objectId);

test("member_subject_uses_draft_masks_and_preview_object_masks", () => {
  const session = { teamId: "t1", vaultId: "v1", subject: { type: "member" as const, user_id: "bob" } };
  const draft = { role_ids: ["editor"], allow: 0, deny: 0 };
  const s = previewSnapshot(base, session, draft, response(preview({ c1: VIEW }), preview({ c1: VIEW | CONNECT })));

  expect(s.myUserId).toBe("bob");
  expect(can(s, "CONNECT", "c1")).toBe(true);
  expect(can(s, "EDIT_CONNECTIONS")).toBe(true);
  expect(can(s, "EDIT_SNIPPETS")).toBe(false);
  expect(s.objectAccess?.t2).toBe(base.objectAccess?.t2);
  expect(s.membersByTeam.t2).toBe(base.membersByTeam.t2);
});

test("role_subject_gets_a_synthetic_member_with_the_drafted_role_bits", () => {
  const session = { teamId: "t1", vaultId: "v1", subject: { type: "role" as const, role_id: "viewer" } };
  const s = previewSnapshot(base, session, { permissions: VIEW | EDIT_SNIPPETS }, response(preview({})));

  expect(s.myUserId).toBe(PREVIEW_ROLE_USER_ID);
  expect(s.membersByTeam.t1.find((m) => m.user_id === PREVIEW_ROLE_USER_ID)?.role_ids).toEqual(["viewer"]);
  expect(can(s, "EDIT_SNIPPETS")).toBe(true);
  expect(can(s, "EDIT_CONNECTIONS")).toBe(false);
  expect(base.rolesByTeam.t1.find((r) => r.id === "viewer")?.permissions).toBe(VIEW);
});

test("objects_missing_from_the_preview_fall_back_to_team_level", () => {
  const session = { teamId: "t1", vaultId: "v1", subject: { type: "member" as const, user_id: "bob" } };
  const s = previewSnapshot(base, session, null, response(preview({ c1: 0 })));

  expect(s.objectAccess?.t1.c1.myPermissions).toBe(0);
  expect(s.objectAccess?.t1.c2).toBeUndefined();
  expect(can(s, "VIEW", "c1")).toBe(false);
  expect(can(s, "VIEW", "c2")).toBe(true);
  expect(can(s, "EDIT_CONNECTIONS", "c2")).toBe(false);
});
