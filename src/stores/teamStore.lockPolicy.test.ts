// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({ listTeams: vi.fn() }));
vi.mock("@/services/teamService", async (orig) => ({ ...(await orig<object>()), listTeams: api.listTeams }));

import { useTeamStore } from "./teamStore";
import { useOrgLockPolicyStore } from "./orgLockPolicyStore";

const row = (id: string, lock_policy: { max_minutes: number; force_vault: boolean } | null) => ({
  id, name: id, owner_id: "o", owner_tier: "business", created_at: "", role_ids: [], permission_allow: 0, permission_deny: 0, lock_policy,
});

beforeEach(() => {
  useTeamStore.setState({ teams: [], rolesByTeam: {} });
  useOrgLockPolicyStore.setState({ policy: null });
  api.listTeams.mockReset();
});

test("a successful fetch stores the combined policy", async () => {
  api.listTeams.mockResolvedValue([row("a", { max_minutes: 30, force_vault: false }), row("b", { max_minutes: 15, force_vault: true })]);
  await useTeamStore.getState().loadTeams();
  expect(useOrgLockPolicyStore.getState().policy).toEqual({ maxMinutes: 15, forceVault: true });
});

test("a fetch with no policy clears it", async () => {
  useOrgLockPolicyStore.setState({ policy: { maxMinutes: 5, forceVault: false } });
  api.listTeams.mockResolvedValue([row("a", null)]);
  await useTeamStore.getState().loadTeams();
  expect(useOrgLockPolicyStore.getState().policy).toBeNull();
});

test("a failed fetch keeps the cached policy", async () => {
  useOrgLockPolicyStore.setState({ policy: { maxMinutes: 5, forceVault: true } });
  api.listTeams.mockRejectedValue(new Error("500"));
  await useTeamStore.getState().loadTeams();
  expect(useOrgLockPolicyStore.getState().policy).toEqual({ maxMinutes: 5, forceVault: true });
});

test("a policy-only change is not swallowed by the unchanged-list shortcut", async () => {
  api.listTeams.mockResolvedValue([row("a", null)]);
  await useTeamStore.getState().loadTeams();
  api.listTeams.mockResolvedValue([row("a", { max_minutes: 15, force_vault: false })]);
  await useTeamStore.getState().loadTeams();
  expect(useTeamStore.getState().teams[0].lock_policy).toEqual({ max_minutes: 15, force_vault: false });
  expect(useOrgLockPolicyStore.getState().policy).toEqual({ maxMinutes: 15, forceVault: false });
});
