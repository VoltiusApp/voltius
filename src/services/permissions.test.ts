import { test, expect, describe, it } from "vitest";
import {
  resolveCan, PERM_BITS, effectivePermissions, crossesVaultKeyGate, resolveMemberReadOnlyReason,
  PERMISSION_GROUPS, resolveObjectPermissions, ALL_PERMISSION_BITS, OBJECT_RULE_BITS, OBJECT_RULE_ROWS,
  type Permission, type PermissionSnapshot, type RuleEntry,
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

test("a personal vault turned into a team vault is gated by its team roles", () => {
  const s = snap({
    vaults: [vault("personal", "t1")],
    rolesByTeam: { t1: [role("r1", PERM_BITS.CONNECT)] },
    membersByTeam: { t1: [member("u1", ["r1"])] },
  });
  expect(resolveCan(s, "CONNECT", "personal")).toBe(true);
  expect(resolveCan(s, "EDIT_KEYS", "personal")).toBe(false);
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
    rolesByTeam: { t1: [role("r1", PERM_BITS.CONNECT)] },
    membersByTeam: { t1: [member("u1", ["r1"])] },
  });
  expect(resolveCan(s, "CONNECT", "v1")).toBe(true);
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
  it("role grants CONNECT only; deny CONNECT crosses the gate", () => {
    const roles: TeamRole[] = [role("r1", PERM_BITS.CONNECT)];
    const m = { ...member("u1", ["r1"]), permission_allow: 0, permission_deny: 0 };
    expect(crossesVaultKeyGate(m, roles, { allow: 0, deny: PERM_BITS.CONNECT })).toBe(true);
  });

  it("already denying CONNECT; submitting the identical deny again does not cross", () => {
    const roles: TeamRole[] = [role("r1", PERM_BITS.CONNECT)];
    const m = { ...member("u1", ["r1"]), permission_allow: 0, permission_deny: PERM_BITS.CONNECT };
    expect(crossesVaultKeyGate(m, roles, { allow: 0, deny: PERM_BITS.CONNECT })).toBe(false);
  });

  it("role grants VIEW_SECRETS and CONNECT; deny VIEW_SECRETS only does not cross", () => {
    const roles: TeamRole[] = [role("r1", PERM_BITS.VIEW_SECRETS | PERM_BITS.CONNECT)];
    const m = { ...member("u1", ["r1"]), permission_allow: 0, permission_deny: 0 };
    expect(crossesVaultKeyGate(m, roles, { allow: 0, deny: PERM_BITS.VIEW_SECRETS })).toBe(false);
  });

  it("role grants VIEW_SECRETS and CONNECT; deny CONNECT crosses, since secrets depend on it", () => {
    const roles: TeamRole[] = [role("r1", PERM_BITS.VIEW_SECRETS | PERM_BITS.CONNECT)];
    const m = { ...member("u1", ["r1"]), permission_allow: 0, permission_deny: 0 };
    expect(crossesVaultKeyGate(m, roles, { allow: 0, deny: PERM_BITS.CONNECT })).toBe(true);
  });

  it("roleless member with allow CONNECT; clearing to inherit crosses", () => {
    const m = { ...member("u1", []), permission_allow: PERM_BITS.CONNECT, permission_deny: 0 };
    expect(crossesVaultKeyGate(m, [], { allow: 0, deny: 0 })).toBe(true);
  });

  it("role grants CONNECT; deny EDIT_KEYS does not cross", () => {
    const roles: TeamRole[] = [role("r1", PERM_BITS.CONNECT)];
    const m = { ...member("u1", ["r1"]), permission_allow: 0, permission_deny: 0 };
    expect(crossesVaultKeyGate(m, roles, { allow: 0, deny: PERM_BITS.EDIT_KEYS })).toBe(false);
  });
});

describe("Connect dependency (mirror of server with_dependencies)", () => {
  it("View secrets and Copy secrets without Connect grant nothing", () => {
    const roles = [role("r1", PERM_BITS.VIEW | PERM_BITS.VIEW_SECRETS | PERM_BITS.COPY_SECRETS)];
    expect(effectivePermissions({ role_ids: ["r1"] }, roles)).toBe(PERM_BITS.VIEW);
  });

  it("denying Connect on an object also removes its secrets", () => {
    const roles = [role("r1", PERM_BITS.VIEW | PERM_BITS.CONNECT | PERM_BITS.VIEW_SECRETS | PERM_BITS.COPY_SECRETS)];
    const entries: RuleEntry[] = [{ subject_type: "everyone", subject_id: null, allow: 0, deny: PERM_BITS.CONNECT }];
    expect(resolveObjectPermissions({ ...member("u1", ["r1"]) }, roles, entries)).toBe(PERM_BITS.VIEW);
  });

  it("Administrator satisfies the dependency", () => {
    const roles = [role("r1", PERM_BITS.ADMINISTRATOR | PERM_BITS.VIEW_SECRETS)];
    expect(effectivePermissions({ role_ids: ["r1"] }, roles)).toBe(PERM_BITS.ADMINISTRATOR | PERM_BITS.VIEW_SECRETS);
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

const B = PERM_BITS;
const everyone = (allow: number, deny = 0): RuleEntry => ({ subject_type: "everyone", subject_id: null, allow, deny });
const roleRule = (id: string, allow: number, deny = 0): RuleEntry => ({ subject_type: "role", subject_id: id, allow, deny });
const memberRule = (id: string, allow: number, deny = 0): RuleEntry => ({ subject_type: "member", subject_id: id, allow, deny });
const m = (roleIds: string[], allow = 0, deny = 0) => ({ ...member("u1", roleIds), permission_allow: allow, permission_deny: deny });

describe("resolveObjectPermissions (mirror of server object_permissions)", () => {
  const roles = [role("dev", B.VIEW | B.CONNECT), role("ops", B.VIEW | B.EDIT_CONNECTIONS), role("own", B.ADMINISTRATOR)];

  it("no rule set returns the team mask", () => {
    expect(resolveObjectPermissions(m(["dev"]), roles, null)).toBe(B.VIEW | B.CONNECT);
  });
  it("@everyone deny removes, then a role allow restores (more specific wins)", () => {
    const p = resolveObjectPermissions(m(["dev"]), roles, [everyone(0, B.CONNECT), roleRule("dev", B.CONNECT)]);
    expect(p & B.CONNECT).toBe(B.CONNECT);
  });
  it("within the role layer allow beats deny", () => {
    const p = resolveObjectPermissions(m(["dev", "ops"]), roles, [roleRule("dev", 0, B.CONNECT), roleRule("ops", B.CONNECT)]);
    expect(p & B.CONNECT).toBe(B.CONNECT);
  });
  it("a member rule beats every role rule", () => {
    const p = resolveObjectPermissions(m(["dev"]), roles, [roleRule("dev", B.CONNECT), memberRule("u1", 0, B.CONNECT)]);
    expect(p & B.CONNECT).toBe(0);
  });
  it("D8: a team-level deny stays absolute", () => {
    const p = resolveObjectPermissions(m(["dev"], 0, B.CONNECT), roles, [memberRule("u1", B.CONNECT)]);
    expect(p & B.CONNECT).toBe(0);
  });
  it("no VIEW means nothing at all", () => {
    expect(resolveObjectPermissions(m(["dev"]), roles, [everyone(0, B.VIEW)])).toBe(0);
  });
  it("Administrator ignores rules but not the team deny", () => {
    expect(resolveObjectPermissions(m(["own"], 0, B.COPY_SECRETS), roles, [everyone(0, B.VIEW)]))
      .toBe(ALL_PERMISSION_BITS & ~B.COPY_SECRETS);
  });
});

test("object rules never carry Administrator or team-only bits", () => {
  expect(OBJECT_RULE_BITS & B.ADMINISTRATOR).toBe(0);
  expect(OBJECT_RULE_BITS & B.INVITE_MEMBERS).toBe(0);
  for (const rows of Object.values(OBJECT_RULE_ROWS)) {
    for (const p of rows) expect(OBJECT_RULE_BITS & B[p]).toBe(B[p]);
  }
});

test("View leads the data-access group and Administrator has its own group first", () => {
  expect(PERMISSION_GROUPS[0]).toEqual({ key: "administration", permissions: ["ADMINISTRATOR"] });
  expect(PERMISSION_GROUPS[1].permissions[0]).toBe("VIEW");
});

describe("resolveCan with an object id", () => {
  const base = snap({
    vaults: [vault("t1", "t1")],
    rolesByTeam: { t1: [role("r1", PERM_BITS.VIEW | PERM_BITS.EDIT_CONNECTIONS)] },
    membersByTeam: { t1: [member("u1", ["r1"])] },
    objectAccess: {
      t1: {
        locked: { type: "connection", ruleSetId: "s1", myPermissions: PERM_BITS.VIEW, parentId: null, deleted: false },
        opened: { type: "connection", ruleSetId: "s2", myPermissions: PERM_BITS.VIEW | PERM_BITS.CONNECT, parentId: null, deleted: false },
      },
    },
  });

  it("reads the object's mask, not the team's", () => {
    expect(resolveCan(base, "EDIT_CONNECTIONS", "t1", "locked")).toBe(false);
    expect(resolveCan(base, "CONNECT", "t1", "opened")).toBe(true);
  });
  it("falls back to the team mask for an object with no entry", () => {
    expect(resolveCan(base, "EDIT_CONNECTIONS", "t1", "unknown")).toBe(true);
  });
  it("ignores the object id in a personal vault", () => {
    expect(resolveCan(snap({ objectAccess: base.objectAccess }), "EDIT_CONNECTIONS", "personal", "locked")).toBe(true);
  });
});
