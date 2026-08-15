import { expect, test, vi } from "vitest";
import type { TeamMember } from "@/services/teamService";
import { listTeams, listMembers, keyStatus, inviteMember, removeMember, setMemberRole, type TeamPorts } from "./team";

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  team_id: "t1", user_id: "u1", invited_by_display_name: null, joined_at: "",
  handle: "one-heron-1111", public_key: "pk1", role_ids: ["r1"], is_online: true, ...over,
});

function ports(over: Partial<TeamPorts> = {}): TeamPorts {
  return {
    teams: () => [{ id: "t1", name: "Team One", owner_id: "u0", owner_tier: "teams", created_at: "", role_ids: ["r1"] }],
    loadTeams: vi.fn(async () => {}),
    members: () => [member()],
    loadMembers: vi.fn(async () => {}),
    pendingInvitations: () => [],
    loadPendingInvitations: vi.fn(async () => {}),
    roles: () => [
      { id: "r1", team_id: "t1", name: "manager", permissions: 512, is_builtin: true, position: 1, created_at: "" },
      { id: "r3", team_id: "t1", name: "operator", permissions: 0, is_builtin: false, position: 2, created_at: "" },
    ],
    loadRoles: vi.fn(async () => {}),
    vaultStatus: () => "loaded",
    keyHolders: async () => ["u1"],
    myUserId: async () => "u0",
    addMember: vi.fn(async () => {}),
    addMemberById: vi.fn(async () => ({ status: "pending" as const })),
    removeMember: vi.fn(async () => {}),
    assignMemberRole: vi.fn(async () => {}),
    removeMemberRole: vi.fn(async () => {}),
    ...over,
  } as TeamPorts;
}

test("listTeams resolves role ids to names and carries the vault status", async () => {
  const teams = await listTeams(ports());
  expect(teams).toEqual([
    { id: "t1", name: "Team One", ownerTier: "teams", myRoles: ["manager"], myRoleIds: ["r1"], vaultStatus: "loaded" },
  ]);
});

test("listMembers merges pending invitations, tagged by state", async () => {
  const p = ports({
    pendingInvitations: () => [{
      id: "u9", display_name: "nine-quail-9999", role: "member",
      invited_by_display_name: "one-heron-1111", created_at: "", expires_at: "",
    }],
  });
  const rows = await listMembers(p, "t1");
  expect(rows).toEqual([
    { userId: "u1", displayName: "one-heron-1111", roles: ["manager"], roleIds: ["r1"], isOnline: true, state: "member" },
    // The pending row carries the INVITATION id, under a name no caller can
    // mistake for a user id: member_remove(teamId, "u9") would address nothing.
    { invitationId: "u9", displayName: "nine-quail-9999", roles: ["member"], isOnline: false, state: "pending" },
  ]);
});

test("keyStatus reports a member who can be keyed but has not been — the keyless window", async () => {
  const p = ports({
    members: () => [member(), member({ user_id: "u2", handle: "two-lynx-2222", public_key: "pk2" })],
    keyHolders: async () => ["u1"],
  });
  const [status] = await keyStatus(p, "t1");
  expect(status.members).toEqual([
    { userId: "u1", displayName: "one-heron-1111", hasPublicKey: true, hasWrappedKey: true },
    { userId: "u2", displayName: "two-lynx-2222", hasPublicKey: true, hasWrappedKey: false },
  ]);
});

test("keyStatus distinguishes a member who has never published a public key", async () => {
  const p = ports({ members: () => [member({ user_id: "u3", handle: "three-otter-3333", public_key: "" })] });
  const [status] = await keyStatus(p, "t1");
  expect(status.members[0]).toEqual({ userId: "u3", displayName: "three-otter-3333", hasPublicKey: false, hasWrappedKey: false });
});

test("keyStatus reports iHoldKey false when the caller is not a key holder", async () => {
  const p = ports({ myUserId: async () => "u7", keyHolders: async () => ["u1"] });
  const [status] = await keyStatus(p, "t1");
  expect(status.iHoldKey).toBe(false);
});

test("keyStatus covers every team when no teamId is given", async () => {
  const p = ports({
    teams: () => [
      { id: "t1", name: "One", owner_id: "u0", owner_tier: "teams", created_at: "", role_ids: [] },
      { id: "t2", name: "Two", owner_id: "u0", owner_tier: "free", created_at: "", role_ids: [] },
    ],
  });
  expect((await keyStatus(p)).map((s) => s.teamId)).toEqual(["t1", "t2"]);
});

test("keyStatus surfaces a vault status the caller cannot read instead of throwing", async () => {
  const p = ports({ vaultStatus: () => "forbidden", keyHolders: async () => { throw new Error("403"); } });
  const [status] = await keyStatus(p, "t1");
  expect(status.vaultStatus).toBe("forbidden");
  expect(status.members.every((m) => m.hasWrappedKey === false)).toBe(true);
});

test("inviteMember by email reports invited and returns no key state yet", async () => {
  const addMember = vi.fn(async () => {});
  const res = await inviteMember(ports({ addMember }), { teamId: "t1", email: "b@example.com" });
  expect(addMember).toHaveBeenCalledWith("t1", "b@example.com", undefined);
  expect(res).toEqual({ ok: true, result: { status: "invited", key: null } });
});

test("inviteMember by userId returns that member's key state so the keyless window is visible", async () => {
  const p = ports({
    addMemberById: vi.fn(async () => ({ status: "pending" as const })),
    members: () => [member({ user_id: "u2", handle: "two-lynx-2222", public_key: "pk2" })],
    keyHolders: async () => [],
  });
  const res = await inviteMember(p, { teamId: "t1", userId: "u2" });
  expect(res).toEqual({
    ok: true,
    result: { status: "pending", key: { userId: "u2", displayName: "two-lynx-2222", hasPublicKey: true, hasWrappedKey: false } },
  });
});

test("inviteMember refuses when neither email nor userId is given", async () => {
  const res = await inviteMember(ports(), { teamId: "t1" });
  expect(res).toEqual({ ok: false, error: "give exactly one of email or userId" });
});

test("inviteMember refuses when both email and userId are given", async () => {
  const res = await inviteMember(ports(), { teamId: "t1", email: "b@example.com", userId: "u2" });
  expect(res).toEqual({ ok: false, error: "give exactly one of email or userId" });
});

test("a server permission failure comes back as a refusal, not a throw", async () => {
  const p = ports({ removeMember: vi.fn(async () => { throw new Error("403 Forbidden"); }) });
  expect(await removeMember(p, "t1", "u2")).toEqual({ ok: false, error: "403 Forbidden" });
});

test("setMemberRole removes the old roles then assigns the new one", async () => {
  const calls: string[] = [];
  const p = ports({
    members: () => [member({ user_id: "u2", role_ids: ["r1", "r2"] })],
    removeMemberRole: vi.fn(async (_t: string, _u: string, r: string) => { calls.push(`-${r}`); }),
    assignMemberRole: vi.fn(async (_t: string, _u: string, r: string) => { calls.push(`+${r}`); }),
  });
  expect(await setMemberRole(p, "t1", "u2", "r3")).toEqual({ ok: true, result: null });
  expect(calls).toEqual(["-r1", "-r2", "+r3"]);
});

test("setMemberRole names the state left behind when the assign fails after the removes", async () => {
  const p = ports({
    members: () => [member({ user_id: "u2", role_ids: ["r1"] })],
    assignMemberRole: vi.fn(async () => { throw new Error("500"); }),
  });
  expect(await setMemberRole(p, "t1", "u2", "r3")).toEqual({
    ok: false,
    error: "removed the previous roles but could not assign r3 (500); u2 now holds no role in t1",
  });
});

test("setMemberRole reports a permission failure on loadMembers instead of throwing", async () => {
  const p = ports({ loadMembers: vi.fn(async () => { throw new Error("403 Forbidden"); }) });
  expect(await setMemberRole(p, "t1", "u2", "r3")).toEqual({ ok: false, error: "403 Forbidden" });
});

test("setMemberRole refuses an unknown member without touching any role", async () => {
  const assignMemberRole = vi.fn(async () => {});
  const p = ports({ members: () => [], assignMemberRole });
  expect(await setMemberRole(p, "t1", "u9", "r3")).toEqual({ ok: false, error: "no such member in that team" });
  expect(assignMemberRole).not.toHaveBeenCalled();
});

test("setMemberRole accepts a role NAME, which is all the read verbs report as a label", async () => {
  const assignMemberRole = vi.fn(async () => {});
  const p = ports({ members: () => [member({ user_id: "u2", role_ids: ["r1"] })], assignMemberRole });
  expect(await setMemberRole(p, "t1", "u2", "operator")).toEqual({ ok: true, result: null });
  expect(assignMemberRole).toHaveBeenCalledWith("t1", "u2", "r3");
});

test("setMemberRole refuses an unresolvable role BEFORE removing anything", async () => {
  const removeMemberRole = vi.fn(async () => {});
  const assignMemberRole = vi.fn(async () => {});
  const p = ports({
    members: () => [member({ user_id: "u2", role_ids: ["r1"] })], removeMemberRole, assignMemberRole,
  });
  expect(await setMemberRole(p, "t1", "u2", "nope")).toEqual({
    ok: false,
    error: 'no role "nope" in that team; known roles: manager (r1), operator (r3)',
  });
  expect(removeMemberRole).not.toHaveBeenCalled();
  expect(assignMemberRole).not.toHaveBeenCalled();
});

test("setMemberRole refuses an ambiguous role name and asks for the id", async () => {
  const removeMemberRole = vi.fn(async () => {});
  const p = ports({
    members: () => [member({ user_id: "u2", role_ids: ["r1"] })],
    roles: () => [
      { id: "r1", team_id: "t1", name: "ops", permissions: 0, is_builtin: false, position: 1, created_at: "" },
      { id: "r2", team_id: "t1", name: "Ops", permissions: 0, is_builtin: false, position: 2, created_at: "" },
    ],
    removeMemberRole,
  });
  expect(await setMemberRole(p, "t1", "u2", "ops")).toEqual({
    ok: false,
    error: '"ops" names more than one role in that team; give the role id instead: ops (r1), Ops (r2)',
  });
  expect(removeMemberRole).not.toHaveBeenCalled();
});

test("setMemberRole refuses when the roles cannot be reloaded, without removing anything", async () => {
  const removeMemberRole = vi.fn(async () => {});
  const assignMemberRole = vi.fn(async () => {});
  const p = ports({
    members: () => [member({ user_id: "u2", role_ids: ["r1"] })],
    loadRoles: vi.fn(async () => { throw new Error("403 Forbidden"); }),
    removeMemberRole,
    assignMemberRole,
  });
  expect(await setMemberRole(p, "t1", "u2", "manager")).toEqual({ ok: false, error: "403 Forbidden" });
  expect(removeMemberRole).not.toHaveBeenCalled();
  expect(assignMemberRole).not.toHaveBeenCalled();
});

test("listTeams still reports a team whose roles cannot be read", async () => {
  const p = ports({
    loadRoles: vi.fn(async () => { throw new Error("403 Forbidden"); }),
    roles: () => [],
    vaultStatus: () => "forbidden",
  });
  expect(await listTeams(p)).toEqual([
    { id: "t1", name: "Team One", ownerTier: "teams", myRoles: ["r1"], myRoleIds: ["r1"], vaultStatus: "forbidden" },
  ]);
});

test("listMembers degrades to what is cached when the member load is forbidden", async () => {
  const p = ports({
    loadMembers: vi.fn(async () => { throw new Error("403 Forbidden"); }),
    loadPendingInvitations: vi.fn(async () => { throw new Error("403 Forbidden"); }),
    members: () => [],
    pendingInvitations: () => [],
  });
  expect(await listMembers(p, "t1")).toEqual([]);
});

test("keyStatus keeps a team whose member load rejects, explained by its vault status", async () => {
  const p = ports({
    teams: () => [
      { id: "t1", name: "One", owner_id: "u0", owner_tier: "teams", created_at: "", role_ids: [] },
      { id: "t2", name: "Two", owner_id: "u9", owner_tier: "teams", created_at: "", role_ids: [] },
    ],
    loadMembers: vi.fn(async (id: string) => { if (id === "t2") throw new Error("403 Forbidden"); }),
    members: (id: string) => (id === "t2" ? [] : [member()]),
    vaultStatus: (id: string) => (id === "t2" ? "forbidden" : "loaded"),
  });
  const rows = await keyStatus(p);
  expect(rows.map((r) => [r.teamId, r.vaultStatus, r.members.length])).toEqual([
    ["t1", "loaded", 1], ["t2", "forbidden", 0],
  ]);
});
