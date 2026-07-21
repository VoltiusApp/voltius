import { test, expect, vi, beforeEach } from "vitest";
import type { Team, TeamMember, TeamRole } from "@/services/teamService";

const api = vi.hoisted(() => ({
  listTeams: vi.fn(), listMembers: vi.fn(), listRoles: vi.fn(),
  createRole: vi.fn(), updateRole: vi.fn(), deleteRole: vi.fn(),
  assignMemberRole: vi.fn(), removeMemberRole: vi.fn(), removeMember: vi.fn(),
  listPendingInvitations: vi.fn(), fetchMyPendingInvitations: vi.fn(),
  createTeam: vi.fn(), addMember: vi.fn(), addMemberById: vi.fn(),
}));
vi.mock("@/services/teamService", () => api);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));

import { useTeamStore } from "./teamStore.ts";

const team = (id: string, role_ids: string[] = []): Team =>
  ({ id, name: id, owner_id: "o", owner_tier: "team", created_at: "", role_ids });
const member = (user_id: string, role_ids: string[] = []): TeamMember =>
  ({ team_id: "t1", user_id, display_name: "", public_key: "", invited_by_display_name: null, joined_at: "", role_ids });
const role = (id: string, permissions = 0): TeamRole =>
  ({ id, team_id: "t1", name: id, permissions, is_builtin: false, position: 0 } as TeamRole);

const get = () => useTeamStore.getState();

beforeEach(() => {
  localStorage.clear();
  Object.values(api).forEach((f) => f.mockReset());
  useTeamStore.setState({
    teams: [], membersByTeam: {}, rolesByTeam: {}, pendingInvitationsByTeam: {},
    myPendingInvitations: [], activeTeamId: null, loading: false,
  });
});

test("loadTeams populates teams and auto-selects the first as active", async () => {
  api.listTeams.mockResolvedValue([team("t1"), team("t2")]);
  await get().loadTeams();
  expect(get().teams.map((t) => t.id)).toEqual(["t1", "t2"]);
  expect(get().activeTeamId).toBe("t1");
  expect(get().loading).toBe(false);
});

test("loadTeams keeps the same array reference when data is unchanged (cache identity)", async () => {
  api.listTeams.mockResolvedValue([team("t1", ["r1"])]);
  await get().loadTeams();
  const first = get().teams;
  api.listTeams.mockResolvedValue([team("t1", ["r1"])]); // structurally identical
  await get().loadTeams();
  expect(get().teams).toBe(first); // same reference → no needless re-render
});

test("loadTeams failure clears loading and leaves teams intact", async () => {
  api.listTeams.mockRejectedValue(new Error("offline"));
  await get().loadTeams();
  expect(get().loading).toBe(false);
  expect(get().teams).toEqual([]);
});

test("loadMembers / loadRoles store by team id", async () => {
  api.listMembers.mockResolvedValue([member("u1")]);
  api.listRoles.mockResolvedValue([role("r1", 5)]);
  await get().loadMembers("t1");
  await get().loadRoles("t1");
  expect(get().membersByTeam.t1.map((m) => m.user_id)).toEqual(["u1"]);
  expect(get().rolesByTeam.t1.map((r) => r.id)).toEqual(["r1"]);
});

test("createRole appends to the team's roles", async () => {
  const r = role("r9", 7);
  api.createRole.mockResolvedValue(r);
  useTeamStore.setState({ rolesByTeam: { t1: [role("r1")] } });
  await get().createRole("t1", "r9", 7);
  expect(get().rolesByTeam.t1.map((x) => x.id)).toEqual(["r1", "r9"]);
});

test("updateRole merges updates; deleteRole removes", async () => {
  api.updateRole.mockResolvedValue(undefined);
  api.deleteRole.mockResolvedValue(undefined);
  useTeamStore.setState({ rolesByTeam: { t1: [role("r1", 1), role("r2", 2)] } });
  await get().updateRole("t1", "r1", { permissions: 99 });
  expect(get().rolesByTeam.t1.find((r) => r.id === "r1")!.permissions).toBe(99);
  await get().deleteRole("t1", "r2");
  expect(get().rolesByTeam.t1.map((r) => r.id)).toEqual(["r1"]);
});

test("assignMemberRole adds a role id once; removeMemberRole strips it", async () => {
  api.assignMemberRole.mockResolvedValue(undefined);
  api.removeMemberRole.mockResolvedValue(undefined);
  useTeamStore.setState({ membersByTeam: { t1: [member("u1", ["r1"])] } });
  await get().assignMemberRole("t1", "u1", "r2");
  expect(get().membersByTeam.t1[0].role_ids).toEqual(["r1", "r2"]);
  await get().assignMemberRole("t1", "u1", "r2"); // idempotent — not added twice
  expect(get().membersByTeam.t1[0].role_ids).toEqual(["r1", "r2"]);
  await get().removeMemberRole("t1", "u1", "r1");
  expect(get().membersByTeam.t1[0].role_ids).toEqual(["r2"]);
});

test("removeMember drops the member; removeTeam purges all team-scoped maps", async () => {
  api.removeMember.mockResolvedValue(undefined);
  useTeamStore.setState({
    teams: [team("t1")], membersByTeam: { t1: [member("u1"), member("u2")] },
    rolesByTeam: { t1: [role("r1")] }, pendingInvitationsByTeam: { t1: [] },
  });
  await get().removeMember("t1", "u1");
  expect(get().membersByTeam.t1.map((m) => m.user_id)).toEqual(["u2"]);
  get().removeTeam("t1");
  expect(get().teams).toEqual([]);
  expect(get().membersByTeam.t1).toBeUndefined();
  expect(get().rolesByTeam.t1).toBeUndefined();
});
