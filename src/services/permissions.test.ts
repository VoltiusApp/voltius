import { test, expect, describe, it } from "vitest";
import {
  resolveCan, PERM_BITS, effectivePermissions, crossesVaultKeyGate, resolveMemberReadOnlyReason,
  PERMISSION_GROUPS, type Permission, type PermissionSnapshot,
} from "./permissions.ts";
import type { Team, TeamMember, TeamRole } from "@/services/teamService";
import type { Vault } from "@/stores/vaultStore";

function role(id: string, permissions: number, extra: Partial<TeamRole> = {}): TeamRole {
  return { id, team_id: "t1", name: id, permissions, is_builtin: false, ...extra } as TeamRole;
}
function member(user_id: string, role_ids: string[]): TeamMember {
  return {
    team_id: "t1", user_id, handle: "", public_key: "",
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

describe("effectivePermissions with member overrides", () => {
  const roles: TeamRole[] = [
    { id: "r1", team_id: "t1", name: "editor", permissions: PERM_BITS.CONNECT | PERM_BITS.VIEW_SECRETS, is_builtin: true, position: 2, created_at: "" },
  ];

  it("returns the role union when no override is present", () => {
    expect(effectivePermissions({ role_ids: ["r1"] }, roles)).toBe(
      PERM_BITS.CONNECT | PERM_BITS.VIEW_SECRETS,
    );
  });

  it("adds allowed bits the roles do not grant", () => {
    expect(
      effectivePermissions({ role_ids: ["r1"], permission_allow: PERM_BITS.EDIT_KEYS }, roles),
    ).toBe(PERM_BITS.CONNECT | PERM_BITS.VIEW_SECRETS | PERM_BITS.EDIT_KEYS);
  });

  it("removes denied bits the roles do grant", () => {
    expect(
      effectivePermissions({ role_ids: ["r1"], permission_deny: PERM_BITS.VIEW_SECRETS }, roles),
    ).toBe(PERM_BITS.CONNECT);
  });

  it("lets deny win when a role-granted bit is in both allow and deny masks", () => {
    expect(
      effectivePermissions(
        { role_ids: ["r1"], permission_allow: PERM_BITS.VIEW_SECRETS, permission_deny: PERM_BITS.VIEW_SECRETS },
        roles,
      ),
    ).toBe(PERM_BITS.CONNECT);
  });

  it("grants an allowed bit to a member holding no roles", () => {
    expect(
      effectivePermissions({ role_ids: [], permission_allow: PERM_BITS.CONNECT }, roles),
    ).toBe(PERM_BITS.CONNECT);
  });
});

describe("crossesVaultKeyGate", () => {
  it("role grants VIEW_SECRETS only; deny VIEW_SECRETS crosses the gate", () => {
    const roles: TeamRole[] = [role("r1", PERM_BITS.VIEW_SECRETS)];
    const m = { ...member("u1", ["r1"]), permission_allow: 0, permission_deny: 0 };
    expect(
      crossesVaultKeyGate(m, roles, { allow: 0, deny: PERM_BITS.VIEW_SECRETS }),
    ).toBe(true);
  });

  it("already denying VIEW_SECRETS; submitting the identical deny again does not cross", () => {
    const roles: TeamRole[] = [role("r1", PERM_BITS.VIEW_SECRETS)];
    const m = { ...member("u1", ["r1"]), permission_allow: 0, permission_deny: PERM_BITS.VIEW_SECRETS };
    expect(
      crossesVaultKeyGate(m, roles, { allow: 0, deny: PERM_BITS.VIEW_SECRETS }),
    ).toBe(false);
  });

  it("role grants VIEW_SECRETS and CONNECT; deny VIEW_SECRETS only does not cross (CONNECT still gates)", () => {
    const roles: TeamRole[] = [role("r1", PERM_BITS.VIEW_SECRETS | PERM_BITS.CONNECT)];
    const m = { ...member("u1", ["r1"]), permission_allow: 0, permission_deny: 0 };
    expect(
      crossesVaultKeyGate(m, roles, { allow: 0, deny: PERM_BITS.VIEW_SECRETS }),
    ).toBe(false);
  });

  it("role grants VIEW_SECRETS and COPY_SECRETS; deny COPY_SECRETS only does not cross", () => {
    const roles: TeamRole[] = [role("r1", PERM_BITS.VIEW_SECRETS | PERM_BITS.COPY_SECRETS)];
    const m = { ...member("u1", ["r1"]), permission_allow: 0, permission_deny: 0 };
    expect(
      crossesVaultKeyGate(m, roles, { allow: 0, deny: PERM_BITS.COPY_SECRETS }),
    ).toBe(false);
  });

  it("roleless member with allow VIEW_SECRETS; clearing to inherit crosses", () => {
    const roles: TeamRole[] = [];
    const m = { ...member("u1", []), permission_allow: PERM_BITS.VIEW_SECRETS, permission_deny: 0 };
    expect(
      crossesVaultKeyGate(m, roles, { allow: 0, deny: 0 }),
    ).toBe(true);
  });

  it("role grants VIEW_SECRETS; deny EDIT_KEYS does not cross", () => {
    const roles: TeamRole[] = [role("r1", PERM_BITS.VIEW_SECRETS)];
    const m = { ...member("u1", ["r1"]), permission_allow: 0, permission_deny: 0 };
    expect(
      crossesVaultKeyGate(m, roles, { allow: 0, deny: PERM_BITS.EDIT_KEYS }),
    ).toBe(false);
  });

  it("role grants VIEW_SECRETS and an unrelated bit; deny VIEW_SECRETS still crosses", () => {
    const roles: TeamRole[] = [role("r1", PERM_BITS.VIEW_SECRETS | PERM_BITS.EDIT_KEYS)];
    const m = { ...member("u1", ["r1"]), permission_allow: 0, permission_deny: 0 };
    expect(
      crossesVaultKeyGate(m, roles, { allow: 0, deny: PERM_BITS.VIEW_SECRETS }),
    ).toBe(true);
  });
});

describe("resolveMemberReadOnlyReason", () => {
  const admin = role("r-admin", 0, { position: 0 });
  const target = role("r-target", 0, { position: 1 });

  function reason(over: Partial<Parameters<typeof resolveMemberReadOnlyReason>[0]> = {}) {
    return resolveMemberReadOnlyReason({
      canManageMembers: true,
      isTargetOwner: false,
      isMe: false,
      viewerRoleIds: ["r-admin"],
      targetRoleIds: ["r-target"],
      teamRoles: [admin, target],
      offendingBits: 0,
      ...over,
    });
  }

  it("no manage permission wins first", () => {
    expect(reason({ canManageMembers: false })).toBe("noManage");
  });

  it("target is owner", () => {
    expect(reason({ isTargetOwner: true })).toBe("owner");
  });

  it("editing yourself", () => {
    expect(reason({ isMe: true })).toBe("self");
  });

  it("viewer strictly above target: no reason", () => {
    expect(reason()).toBeNull();
  });

  it("viewer at or below target's position: higherRole", () => {
    expect(reason({ viewerRoleIds: ["r-target"], targetRoleIds: ["r-admin"] })).toBe("higherRole");
  });

  it("absent viewer fails closed: higherRole", () => {
    expect(reason({ viewerRoleIds: null })).toBe("higherRole");
  });

  it("roleless viewer fails closed: higherRole", () => {
    expect(reason({ viewerRoleIds: [] })).toBe("higherRole");
  });

  it("roleless target passes hierarchy", () => {
    expect(reason({ targetRoleIds: [] })).toBeNull();
  });

  it("hierarchy passes but offending bits remain: notHeld", () => {
    expect(reason({ offendingBits: PERM_BITS.VIEW_SECRETS })).toBe("notHeld");
  });
});

test("PERMISSION_GROUPS partitions every Permission exactly once", () => {
  const allPermissions = Object.keys(PERM_BITS) as Permission[];
  const grouped = PERMISSION_GROUPS.flatMap((g) => g.permissions);
  expect(new Set(grouped).size).toBe(grouped.length);
  expect([...grouped].sort()).toEqual([...allPermissions].sort());
});

test("resolveCan uses team-level deny in the team fallback (before membersByTeam loads)", () => {
  const s = snap({
    teams: [{ id: "t1", name: "t1", owner_id: "o", owner_tier: "team", created_at: "", role_ids: ["r1"], permission_deny: PERM_BITS.VIEW_SECRETS }],
    rolesByTeam: { t1: [role("r1", PERM_BITS.VIEW_SECRETS | PERM_BITS.CONNECT)] },
  });
  expect(resolveCan(s, "VIEW_SECRETS", "t1")).toBe(false);
  expect(resolveCan(s, "CONNECT", "t1")).toBe(true);
});
