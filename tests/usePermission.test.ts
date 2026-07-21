import { test, expect } from "vitest";
import { effectivePermissions, hasBuiltinRole, PERM_BITS } from "../src/hooks/usePermission.ts";
import type { TeamMember, TeamRole } from "../src/services/teamService.ts";

function role(id: string, permissions: number, over: Partial<TeamRole> = {}): TeamRole {
  return { id, team_id: "t1", name: id, permissions, is_builtin: false, position: 0, created_at: "", ...over };
}
function member(role_ids: string[]): TeamMember {
  return { team_id: "t1", user_id: "u1", invited_by_display_name: null, joined_at: "", display_name: "", public_key: "", role_ids };
}

test("effectivePermissions ORs bits across all assigned roles", () => {
  const roles = [role("a", PERM_BITS.VIEW_SECRETS), role("b", PERM_BITS.EDIT_CONNECTIONS)];
  expect(effectivePermissions(member(["a", "b"]), roles)).toBe(PERM_BITS.VIEW_SECRETS | PERM_BITS.EDIT_CONNECTIONS);
});

test("effectivePermissions ignores role_ids not present in roles list", () => {
  const roles = [role("a", PERM_BITS.CONNECT)];
  expect(effectivePermissions(member(["a", "missing"]), roles)).toBe(PERM_BITS.CONNECT);
});

test("effectivePermissions is 0 for a member with no roles", () => {
  expect(effectivePermissions(member([]), [role("a", PERM_BITS.MANAGE_VAULT)])).toBe(0);
});

test("hasBuiltinRole matches only builtin roles by name", () => {
  const roles = [
    role("owner-id", PERM_BITS.MANAGE_VAULT, { name: "Owner", is_builtin: true }),
    role("custom-id", PERM_BITS.MANAGE_VAULT, { name: "Owner", is_builtin: false }),
  ];
  expect(hasBuiltinRole(member(["owner-id"]), "Owner", roles)).toBe(true);
  expect(hasBuiltinRole(member(["custom-id"]), "Owner", roles)).toBe(false);
  expect(hasBuiltinRole(member(["owner-id"]), "Admin", roles)).toBe(false);
});
