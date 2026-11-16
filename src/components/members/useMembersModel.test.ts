// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/hooks/usePermission", async () => (await import("@/test/memberPermissions")).memberPermissions(() => 7));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/services/teamVaultSync", () => ({ fetchTeamData: vi.fn(async () => {}) }));
vi.mock("@/services/serverCapabilities", () => ({ useServerMultiOwner: () => false, useServerBillingEnabled: () => false }));

import { useMembersModel } from "./useMembersModel";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useHistoryStore } from "@/stores/historyStore";
import { makeMember, makeRole, makeTeam } from "@/test/team";
import { startPreview, stopPreview } from "@/test/preview";

const OWNER = makeRole("r-owner", 0, { name: "owner", is_builtin: true, position: 0 });
const MEMBER = makeRole("r-mem", 0, { name: "member", is_builtin: true, position: 1 });
const EDITOR = makeRole("r-ed", 0, { name: "editor", position: 2 });
const VIEWER = makeRole("r-view", 0, { name: "viewer", position: 3 });
const ME = makeMember("me", ["r-mem"], { handle: "me-handle", joined_at: "2024-01-01" });
const U1 = makeMember("u1", ["r-mem", "r-ed"], { handle: "amber", joined_at: "2024-01-02" });
const U2 = makeMember("u2", ["r-mem"], { handle: "brisk", joined_at: "2024-01-03" });
const BOSS = makeMember("boss", ["r-owner"], { handle: "zed", joined_at: "2024-01-04" });

const loadMembers = vi.fn(async () => {});
const assignMemberRole = vi.fn(async () => {});
const removeMemberRole = vi.fn(async () => {});

function seed(tier = "business") {
  useTeamStore.setState({
    teams: [makeTeam("t1", { owner_tier: tier, owner_id: "boss" })],
    membersByTeam: { t1: [ME, U1, U2, BOSS] },
    rolesByTeam: { t1: [VIEWER, EDITOR, MEMBER, OWNER] },
    pendingInvitationsByTeam: {},
    loadTeams: vi.fn(async () => {}),
    loadMembers,
    loadRoles: vi.fn(async () => {}),
    loadPendingInvitations: vi.fn(async () => {}),
    assignMemberRole,
    removeMemberRole,
  });
  useVaultStore.setState({ vaults: [{ id: "v1", name: "V", teamId: "t1" }] as never });
}

beforeEach(() => {
  vi.clearAllMocks();
  useHistoryStore.setState({ past: [], future: [] } as never);
  seed();
});
afterEach(() => {
  stopPreview();
  cleanup();
});

test("resolves_team_from_a_local_vault_and_from_a_bare_team_id", () => {
  const local = renderHook(() => useMembersModel("v1")).result.current;
  expect(local.teamId).toBe("t1");
  expect(local.localVault?.id).toBe("v1");
  expect(local.standaloneTeam).toBeUndefined();

  const bare = renderHook(() => useMembersModel("t1")).result.current;
  expect(bare.teamId).toBe("t1");
  expect(bare.localVault).toBeUndefined();
  expect(bare.standaloneTeam?.id).toBe("t1");

  const none = renderHook(() => useMembersModel(null)).result.current;
  expect(none.teamId).toBeNull();
  expect(none.members).toEqual([]);
});

test("visible_filters_by_search_and_role_and_sorts", () => {
  const { result } = renderHook(() => useMembersModel("v1"));
  const ids = (s: string, r: string[], sort: Parameters<typeof result.current.visible>[2]) =>
    result.current.visible(s, r, sort).map((m) => m.user_id);
  expect(ids("", [], "name-asc")).toEqual(["u1", "u2", "me", "boss"]);
  expect(ids("", [], "newest")).toEqual(["boss", "u2", "u1", "me"]);
  expect(ids("", [], "oldest")).toEqual(["me", "u1", "u2", "boss"]);
  expect(ids("amb", [], "name-asc")).toEqual(["u1"]);
  expect(ids("", ["r-ed", "r-owner"], "name-desc")).toEqual(["boss", "u1"]);
  expect(ids("", [], "role-asc")[0]).toBe("boss");
});

test("can_act_on_excludes_self_and_out_of_reach", () => {
  const { result } = renderHook(() => useMembersModel("v1"));
  expect(result.current.canManageMembers).toBe(true);
  expect(result.current.canActOn(U1)).toBe(true);
  expect(result.current.canActOn(ME)).toBe(false);
  expect(result.current.isOwnerMember(BOSS)).toBe(true);
  expect(result.current.myMember?.user_id).toBe("me");
  expect(result.current.canEditMember(ME)).toBe(result.current.canNameMembers);
});

test("role_options_exclude_owner_and_hide_unassigned_custom_roles_when_locked", () => {
  const open = renderHook(() => useMembersModel("v1")).result.current;
  expect(open.roleOptions([U2], "assign").map((r) => r.id)).toEqual(["r-mem", "r-ed", "r-view"]);
  expect(open.roleOptions([U2], "remove").map((r) => r.id)).toEqual(["r-mem", "r-ed", "r-view"]);
  cleanup();

  seed("free");
  const locked = renderHook(() => useMembersModel("v1")).result.current;
  expect(locked.roleOptions([U2], "assign").map((r) => r.id)).toEqual(["r-mem"]);
  expect(locked.roleOptions([U1], "assign").map((r) => r.id)).toEqual(["r-mem", "r-ed"]);
  expect(locked.roleOptions([U1, U2], "assign").map((r) => r.id)).toEqual(["r-mem"]);
});

test("change_role_is_refused_while_previewing", async () => {
  const { result } = renderHook(() => useMembersModel("v1"));
  startPreview();
  await act(async () => { await result.current.changeRole([U2], EDITOR, "assign"); });
  expect(assignMemberRole).not.toHaveBeenCalled();
  expect(useHistoryStore.getState().past).toHaveLength(0);
});

test("change_role_pushes_one_undo_entry_and_reloads", async () => {
  const { result } = renderHook(() => useMembersModel("v1"));
  loadMembers.mockClear();
  await act(async () => { await result.current.changeRole([ME, U2], EDITOR, "assign"); });
  expect(assignMemberRole).toHaveBeenCalledWith("t1", "u2", "r-ed");
  expect(assignMemberRole).toHaveBeenCalledTimes(2);
  expect(useHistoryStore.getState().past).toHaveLength(1);
  expect(loadMembers).toHaveBeenCalledWith("t1");
});
