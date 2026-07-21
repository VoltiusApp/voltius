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

// Mirror of server/src/permissions.rs — update BOTH together if bits change.
const EXPECTED_BITS: Record<string, number> = {
  VIEW_SECRETS: 1, COPY_SECRETS: 2, CONNECT: 4, EDIT_CONNECTIONS: 8,
  EDIT_IDENTITIES: 16, EDIT_KEYS: 32, EDIT_FOLDERS: 64, VIEW_AUDIT_LOG: 128,
  INVITE_MEMBERS: 256, MANAGE_MEMBERS: 512, CREATE_CUSTOM_ROLES: 1024,
  MANAGE_VAULT: 2048, START_TERMINAL_SESSION: 4096, JOIN_TERMINAL_SESSION: 8192,
  VIEW_TERMINAL_SESSIONS: 16384, MANAGE_ROLES: 32768, EDIT_SNIPPETS: 65536,
};

test("PERM_BITS values are stable, unique, and single-bit", () => {
  expect(PERM_BITS as Record<string, number>).toEqual(EXPECTED_BITS);
  const values = Object.values(PERM_BITS);
  expect(new Set(values).size).toBe(values.length); // no duplicate bits
  for (const v of values) expect(v & (v - 1)).toBe(0); // each is a single bit
});
