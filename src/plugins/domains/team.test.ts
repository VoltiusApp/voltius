import { expect, test, vi } from "vitest";
import type { TeamMember } from "@/services/teamService";
import { listTeams, listMembers, keyStatus, type TeamPorts } from "./team";

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  team_id: "t1", user_id: "u1", invited_by_display_name: null, joined_at: "",
  display_name: "One", public_key: "pk1", role_ids: ["r1"], is_online: true, ...over,
});

function ports(over: Partial<TeamPorts> = {}): TeamPorts {
  return {
    teams: () => [{ id: "t1", name: "Team One", owner_id: "u0", owner_tier: "teams", created_at: "", role_ids: ["r1"] }],
    loadTeams: vi.fn(async () => {}),
    members: () => [member()],
    loadMembers: vi.fn(async () => {}),
    pendingInvitations: () => [],
    loadPendingInvitations: vi.fn(async () => {}),
    roles: () => [{ id: "r1", team_id: "t1", name: "manager", permissions: 512, is_builtin: true, position: 1, created_at: "" }],
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
    { id: "t1", name: "Team One", ownerTier: "teams", myRoles: ["manager"], vaultStatus: "loaded" },
  ]);
});

test("listMembers merges pending invitations, tagged by state", async () => {
  const p = ports({
    pendingInvitations: () => [{
      id: "u9", display_name: "Nine", role: "member",
      invited_by_display_name: "One", created_at: "", expires_at: "",
    }],
  });
  const rows = await listMembers(p, "t1");
  expect(rows).toEqual([
    { userId: "u1", displayName: "One", roles: ["manager"], isOnline: true, state: "member" },
    { userId: "u9", displayName: "Nine", roles: ["member"], isOnline: false, state: "pending" },
  ]);
});

test("keyStatus reports a member who can be keyed but has not been — the keyless window", async () => {
  const p = ports({
    members: () => [member(), member({ user_id: "u2", display_name: "Two", public_key: "pk2" })],
    keyHolders: async () => ["u1"],
  });
  const [status] = await keyStatus(p, "t1");
  expect(status.members).toEqual([
    { userId: "u1", displayName: "One", hasPublicKey: true, hasWrappedKey: true },
    { userId: "u2", displayName: "Two", hasPublicKey: true, hasWrappedKey: false },
  ]);
});

test("keyStatus distinguishes a member who has never published a public key", async () => {
  const p = ports({ members: () => [member({ user_id: "u3", display_name: "Three", public_key: "" })] });
  const [status] = await keyStatus(p, "t1");
  expect(status.members[0]).toEqual({ userId: "u3", displayName: "Three", hasPublicKey: false, hasWrappedKey: false });
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
