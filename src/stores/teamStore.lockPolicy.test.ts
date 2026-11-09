// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({ listTeams: vi.fn() }));
vi.mock("@/services/teamService", async (orig) => ({ ...(await orig<object>()), listTeams: api.listTeams }));
vi.mock("@/lib/invoke", () => ({ invoke: vi.fn() }));

import { useTeamStore } from "./teamStore";
import { lockedValue, policyRange } from "./policyStore";
import { useTeamPolicyStore } from "./teamPolicyStore";
import { invoke } from "@/lib/invoke";
import { clearTeamPolicy } from "@/services/policy/teamPolicy";
import { echoTeamDoc, resetPolicy, withTeamPolicy } from "@/test/policy";
import { makeTeam } from "@/test/team";
import type { TeamLockPolicy } from "@/services/teamService";

const row = (id: string, lock_policy: TeamLockPolicy | null) => makeTeam(id, { lock_policy });

beforeEach(() => {
  useTeamStore.setState({ teams: [], rolesByTeam: {} });
  resetPolicy();
  vi.mocked(invoke).mockImplementation(echoTeamDoc);
  api.listTeams.mockReset();
});

test("a successful fetch puts the strictest limits in the policy layer", async () => {
  api.listTeams.mockResolvedValue([row("a", { max_minutes: 30, force_vault: false }), row("b", { max_minutes: 15, force_vault: true })]);
  await useTeamStore.getState().loadTeams();
  await vi.waitFor(() => expect(policyRange("security.lockTimeoutMinutes")).toEqual({ max: 15 }));
  expect(lockedValue("security.lockAction")).toMatchObject({ locked: true, value: "vault", teams: ["b"] });
});

test("a failed fetch keeps the cached policy", async () => {
  withTeamPolicy({ "security.lockTimeoutMinutes": { $range: { max: 15 } } });
  api.listTeams.mockRejectedValue(new Error("500"));
  await useTeamStore.getState().loadTeams();
  expect(policyRange("security.lockTimeoutMinutes")).toEqual({ max: 15 });
});

test("a policy-only change is not swallowed by the unchanged-list shortcut", async () => {
  api.listTeams.mockResolvedValue([row("a", null)]);
  await useTeamStore.getState().loadTeams();
  api.listTeams.mockResolvedValue([row("a", { max_minutes: 15, force_vault: false })]);
  await useTeamStore.getState().loadTeams();
  expect(useTeamStore.getState().teams[0].lock_policy).toEqual({ max_minutes: 15, force_vault: false });
  await vi.waitFor(() => expect(policyRange("security.lockTimeoutMinutes")).toEqual({ max: 15 }));
});

test("a fetch feeds the team policy layer, from lock_policy on an older server", async () => {
  api.listTeams.mockResolvedValue([row("a", { max_minutes: 15, force_vault: true })]);
  await useTeamStore.getState().loadTeams();
  await vi.waitFor(() =>
    expect(useTeamPolicyStore.getState().layer?.policy).toEqual({
      "security.lockTimeoutMinutes": { $range: { max: 15 } },
      "security.lockAction": "vault",
    }),
  );
});

test("a policy-document-only change is not swallowed by the unchanged-list shortcut", async () => {
  const withDoc = (revision: number, policy: Record<string, unknown>) => ({
    ...row("a", null), policy: { version: 1, policy }, policy_revision: revision, joined_at: "2026-01-01T00:00:00Z",
  });
  api.listTeams.mockResolvedValue([withDoc(1, { "security.lockAction": "screen" })]);
  await useTeamStore.getState().loadTeams();
  await vi.waitFor(() => expect(useTeamPolicyStore.getState().layer?.policy).toEqual({ "security.lockAction": "screen" }));
  api.listTeams.mockResolvedValue([withDoc(2, { "security.lockAction": "vault" })]);
  await useTeamStore.getState().loadTeams();
  expect(useTeamStore.getState().teams[0].policy_revision).toBe(2);
  await vi.waitFor(() => expect(useTeamPolicyStore.getState().layer?.policy).toEqual({ "security.lockAction": "vault" }));
});

test("a fetch started before the account's policy is cleared is not applied", async () => {
  let resolve!: (teams: unknown[]) => void;
  api.listTeams.mockReturnValue(new Promise((r) => (resolve = r)));
  const load = useTeamStore.getState().loadTeams();
  clearTeamPolicy();
  resolve([row("a", { max_minutes: 15, force_vault: true })]);
  await load;
  await new Promise((r) => setTimeout(r, 20));
  expect(useTeamPolicyStore.getState().layer).toBeNull();
  expect(useTeamStore.getState().teams).toEqual([]);
});
