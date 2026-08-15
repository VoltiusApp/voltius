import { test, expect, vi, beforeEach } from "vitest";
import type { Team, TeamMember } from "@/services/teamService";

const api = vi.hoisted(() => ({ getMyUserId: vi.fn(), listMembers: vi.fn() }));
vi.mock("@/services/teamService", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getMyUserId: api.getMyUserId,
  listMembers: api.listMembers,
}));

import { useTeamStore } from "@/stores/teamStore";
import { allTeammates, freshPublicKeys, memberHasAccess, memberHasLiveAccess, seatUsage } from "./teamSharing.ts";

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
  api.listMembers.mockReset();
  useTeamStore.setState({
    teams: [], membersByTeam: {}, rolesByTeam: {}, pendingInvitationsByTeam: {},
    myPendingInvitations: [], activeTeamId: null, loading: false,
  });
});

test("dedupes a teammate who is in two of my teams and drops me", async () => {
  seedStore({ teams: ["t1", "t2"], members: { t1: [me, alice], t2: [{ ...alice, team_id: "t2" }, bob] }, myUserId: me.user_id });
  const list = await allTeammates();
  expect(list.map((m) => m.user_id)).toEqual(["alice", "bob"]);
});

test("merges a shared teammate's team_ids into teamIds instead of dropping the other membership", async () => {
  seedStore({ teams: ["t1", "t2"], members: { t1: [alice], t2: [{ ...alice, team_id: "t2" }] }, myUserId: me.user_id });
  const [merged] = await allTeammates();
  expect(merged.teamIds).toEqual(["t1", "t2"]);
});

test("sorts online teammates first", async () => {
  seedStore({ teams: ["t1"], members: { t1: [offlineAnna, onlineZoe] }, myUserId: me.user_id });
  expect((await allTeammates()).map((m) => m.user_id)).toEqual(["zoe", "anna"]);
});

test("reports access through a vault, a live participation, or an existing grant", () => {
  const session = { vaultIds: ["t1"], participantIds: ["bob"], invitedIds: ["carla"] };
  expect(memberHasAccess({ ...alice, teamIds: ["t1"] }, session)).toBe(true);
  expect(memberHasAccess({ ...bob, teamIds: ["t2"] }, session)).toBe(true);
  expect(memberHasAccess({ ...carla, teamIds: ["t3"] }, session)).toBe(true);
  expect(memberHasAccess({ ...dave, teamIds: ["t4"] }, session)).toBe(false);
});

// A standing invite counts against the cap but is not "Has access": the host may
// still withdraw it, and the row must say so.
test("a pending invite is not live access, though it still counts as access", () => {
  const session = { vaultIds: ["t1"], participantIds: ["bob"], invitedIds: ["carla"] };
  expect(memberHasLiveAccess({ ...alice, teamIds: ["t1"] }, session)).toBe(true);
  expect(memberHasLiveAccess({ ...bob, teamIds: ["t2"] }, session)).toBe(true);
  expect(memberHasLiveAccess({ ...carla, teamIds: ["t3"] }, session)).toBe(false);
  expect(memberHasAccess({ ...carla, teamIds: ["t3"] }, session)).toBe(true);
});

test("withdrawing a pending invite frees its seat", () => {
  const cap = 1;
  const invited = { vaultIds: [], participantIds: [], invitedIds: ["carla"] };
  expect(seatUsage(invited, [], cap)).toEqual({ committedSeats: 1, atCap: true });
  // What the server reports back after DELETE .../invitees/carla.
  expect(seatUsage({ ...invited, invitedIds: [] }, [], cap)).toEqual({ committedSeats: 0, atCap: false });
});

test("a shared teammate has access via any of their team_ids, not just the first", () => {
  const sharedAlice = { ...alice, teamIds: ["t1", "t2"] };
  expect(memberHasAccess(sharedAlice, { vaultIds: ["t2"], participantIds: [], invitedIds: [] })).toBe(true);
  expect(memberHasAccess(sharedAlice, { vaultIds: ["t3"], participantIds: [], invitedIds: [] })).toBe(false);
});

test("an empty session grants access to nobody", () => {
  const emptySession = { vaultIds: [], participantIds: [], invitedIds: [] };
  expect(memberHasAccess({ ...alice, teamIds: ["t1"] }, emptySession)).toBe(false);
});

test("freshPublicKeys returns the server's current key, ignoring a stale public_key on the input member", async () => {
  // The caller passes a member with a stale cached public_key (as membersOfTeams
  // would return after a teammate joined post-cache-fill, #66). freshPublicKeys
  // must fetch listMembers directly rather than trust the field on the input.
  api.listMembers.mockResolvedValue([{ ...alice, public_key: "current-key" }]);
  const staleCachedMember = { ...alice, public_key: "stale-cached-key" };
  const keys = await freshPublicKeys([staleCachedMember]);
  expect(keys.get(alice.user_id)).toBe("current-key");
  expect(api.listMembers).toHaveBeenCalledWith(alice.team_id);
});

test("freshPublicKeys queries each distinct team_id once", async () => {
  api.listMembers.mockImplementation(async (teamId: string) =>
    teamId === "t1" ? [alice] : teamId === "t2" ? [bob] : [],
  );
  const keys = await freshPublicKeys([alice, bob, { ...alice }]);
  expect(api.listMembers).toHaveBeenCalledTimes(2);
  expect([...keys.keys()].sort()).toEqual(["alice", "bob"]);
});
