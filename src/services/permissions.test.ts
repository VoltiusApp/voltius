import { test, expect } from "vitest";
import { resolveCan, PERM_BITS, type PermissionSnapshot } from "./permissions.ts";
import type { Team, TeamMember, TeamRole } from "@/services/teamService";
import type { Vault } from "@/stores/vaultStore";

function role(id: string, permissions: number, extra: Partial<TeamRole> = {}): TeamRole {
  return { id, team_id: "t1", name: id, permissions, is_builtin: false, ...extra } as TeamRole;
}
function member(user_id: string, role_ids: string[]): TeamMember {
  return {
    team_id: "t1", user_id, display_name: "", public_key: "",
    invited_by_display_name: null, joined_at: "", role_ids,
  };
}
function team(id: string, role_ids: string[]): Team {
  return { id, name: id, owner_id: "o", owner_tier: "team", created_at: "", role_ids };
}
function vault(id: string, teamId?: string): Vault {
  return teamId ? { id, name: id, teamId } : { id, name: id };
}
function snap(over: Partial<PermissionSnapshot> = {}): PermissionSnapshot {
  return { myUserId: "u1", teams: [], membersByTeam: {}, rolesByTeam: {}, vaults: [], ...over };
}

test("personal vault always allowed, even with no user", () => {
  expect(resolveCan(snap({ myUserId: "" }), "VIEW_SECRETS", "personal")).toBe(true);
});

test("known non-team vault is allowed", () => {
  expect(resolveCan(snap({ vaults: [vault("v1")] }), "EDIT_CONNECTIONS", "v1")).toBe(true);
});

test("no user id → denied for a team vault", () => {
  const s = snap({ myUserId: "", vaults: [vault("v1", "t1")] });
  expect(resolveCan(s, "VIEW_SECRETS", "v1")).toBe(false);
});

test("member found: bit set grants, bit clear denies (via vault.teamId)", () => {
  const s = snap({
    vaults: [vault("v1", "t1")],
    rolesByTeam: { t1: [role("r1", PERM_BITS.VIEW_SECRETS)] },
    membersByTeam: { t1: [member("u1", ["r1"])] },
  });
  expect(resolveCan(s, "VIEW_SECRETS", "v1")).toBe(true);
  expect(resolveCan(s, "EDIT_KEYS", "v1")).toBe(false);
});

test("teamId resolves from vaultId directly when vault not found", () => {
  const s = snap({
    rolesByTeam: { t1: [role("r1", PERM_BITS.MANAGE_MEMBERS)] },
    membersByTeam: { t1: [member("u1", ["r1"])] },
  });
  expect(resolveCan(s, "MANAGE_MEMBERS", "t1")).toBe(true);
});

test("members loaded but user not a member → denied", () => {
  const s = snap({
    rolesByTeam: { t1: [role("r1", PERM_BITS.VIEW_SECRETS)] },
    membersByTeam: { t1: [member("someone-else", ["r1"])] },
  });
  expect(resolveCan(s, "VIEW_SECRETS", "t1")).toBe(false);
});

test("fallback (members not loaded): grants via team.role_ids + roles", () => {
  const s = snap({
    teams: [team("t1", ["r1"])],
    rolesByTeam: { t1: [role("r1", PERM_BITS.EDIT_SNIPPETS)] },
  });
  expect(resolveCan(s, "EDIT_SNIPPETS", "t1")).toBe(true);
  expect(resolveCan(s, "MANAGE_VAULT", "t1")).toBe(false);
});

test("fallback denies when team unknown or roles empty", () => {
  expect(resolveCan(snap({ teams: [] }), "VIEW_SECRETS", "t1")).toBe(false);
  expect(
    resolveCan(snap({ teams: [team("t1", ["r1"])], rolesByTeam: { t1: [] } }), "VIEW_SECRETS", "t1"),
  ).toBe(false);
});
