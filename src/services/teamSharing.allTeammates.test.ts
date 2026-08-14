import { test, expect, vi, beforeEach } from "vitest";
import type { Team, TeamMember } from "@/services/teamService";

const api = vi.hoisted(() => ({ getMyUserId: vi.fn() }));
vi.mock("@/services/teamService", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getMyUserId: api.getMyUserId,
}));

import { useTeamStore } from "@/stores/teamStore";
import { allTeammates, memberHasAccess } from "./teamSharing.ts";

const member = (user_id: string, overrides: Partial<TeamMember> = {}): TeamMember => ({
  team_id: "t1", user_id, display_name: user_id, public_key: "",
  invited_by_display_name: null, joined_at: "", role_ids: [], ...overrides,
});
const team = (id: string): Team => ({ id, name: id, owner_id: "o", owner_tier: "team", created_at: "", role_ids: [] });

const seedStore = (opts: { teams: string[]; members: Record<string, TeamMember[]>; myUserId: string }) => {
  useTeamStore.setState({ teams: opts.teams.map(team), membersByTeam: opts.members });
  api.getMyUserId.mockResolvedValue(opts.myUserId);
};

const me = member("me");
const alice = member("alice", { team_id: "t1", display_name: "Alice" });
const bob = member("bob", { team_id: "t2", display_name: "Bob" });
const carla = member("carla", { team_id: "t3", display_name: "Carla" });
const dave = member("dave", { team_id: "t4", display_name: "Dave" });
const offlineAnna = member("anna", { display_name: "Anna", is_online: false });
const onlineZoe = member("zoe", { display_name: "Zoe", is_online: true });

beforeEach(() => {
  localStorage.clear();
  api.getMyUserId.mockReset();
  useTeamStore.setState({
    teams: [], membersByTeam: {}, rolesByTeam: {}, pendingInvitationsByTeam: {},
    myPendingInvitations: [], activeTeamId: null, loading: false,
  });
});

test("dedupes a teammate who is in two of my teams and drops me", async () => {
  seedStore({ teams: ["t1", "t2"], members: { t1: [me, alice], t2: [alice, bob] }, myUserId: me.user_id });
  const list = await allTeammates();
  expect(list.map((m) => m.user_id)).toEqual(["alice", "bob"]);
});

test("sorts online teammates first", async () => {
  seedStore({ teams: ["t1"], members: { t1: [offlineAnna, onlineZoe] }, myUserId: me.user_id });
  expect((await allTeammates()).map((m) => m.user_id)).toEqual(["zoe", "anna"]);
});

test("reports access through a vault, a live participation, or an existing grant", () => {
  const session = { vaultIds: ["t1"], participantIds: ["bob"], invitedIds: ["carla"] };
  expect(memberHasAccess({ ...alice, team_id: "t1" }, session)).toBe(true);
  expect(memberHasAccess(bob, session)).toBe(true);
  expect(memberHasAccess(carla, session)).toBe(true);
  expect(memberHasAccess(dave, session)).toBe(false);
});
