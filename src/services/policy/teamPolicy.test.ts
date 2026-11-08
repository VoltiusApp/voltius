// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@/services/lanSync", () => ({ clearLanSyncScopes: async () => {} }));

import type { Team } from "@/services/teamService";
import { refreshTeamPolicy, teamDocsFrom } from "./teamPolicy";
import { lockedValue, policyRange } from "@/stores/policyStore";
import { useTeamPolicyStore } from "@/stores/teamPolicyStore";
import { ACCOUNT_SCOPED_STORAGE_KEYS, parkAccountUiState, restoreAccountUiState } from "@/stores/persistedAccountUiState";
import { clearAccountUiState } from "@/services/vault";
import { echoTeamDoc, resetPolicy } from "@/test/policy";

const TIMEOUT = "security.lockTimeoutMinutes";
const ACTION = "security.lockAction";

const team = (id: string, extra: Partial<Team> = {}): Team => ({
  id,
  name: `Team ${id}`,
  owner_id: "o",
  owner_tier: "business",
  created_at: "",
  role_ids: [],
  ...extra,
});

const vaultLock = (id: string, revision = 1) =>
  team(id, { policy: { version: 1, policy: { [ACTION]: "vault" } }, policy_revision: revision, joined_at: "2026-01-01T00:00:00Z" });

const checkCalls = () => mocks.invoke.mock.calls.filter(([cmd]) => cmd === "policy_check_team_doc").length;

describe("team policy", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(echoTeamDoc);
    resetPolicy();
  });

  it("old server: lock_policy without policy field becomes the two app-lock keys", async () => {
    const old = team("a", { lock_policy: { max_minutes: 15, force_vault: true } });
    expect(teamDocsFrom([old]).map((d) => JSON.parse(d.text))).toEqual([
      { version: 1, policy: { [TIMEOUT]: { $range: { max: 15 } }, [ACTION]: "vault" } },
    ]);
    await refreshTeamPolicy([old]);
    expect(policyRange(TIMEOUT)).toEqual({ max: 15 });
    expect(lockedValue(ACTION)).toEqual({ locked: true, value: "vault", source: "server", teams: ["Team a"] });
  });

  it("old server without force_vault only caps the timeout", () => {
    const old = team("a", { lock_policy: { max_minutes: 30, force_vault: false } });
    expect(teamDocsFrom([old]).map((d) => JSON.parse(d.text).policy)).toEqual([{ [TIMEOUT]: { $range: { max: 30 } } }]);
  });

  it("policy null means no team doc even if lock_policy is set", async () => {
    const t = team("a", { policy: null, lock_policy: { max_minutes: 15, force_vault: true } });
    expect(teamDocsFrom([t])).toEqual([]);
    await refreshTeamPolicy([t]);
    expect(checkCalls()).toBe(0);
    expect(lockedValue(ACTION)).toEqual({ locked: false });
  });

  it("same team ids and revisions skip re-validation", async () => {
    await refreshTeamPolicy([vaultLock("a")]);
    await refreshTeamPolicy([vaultLock("a")]);
    expect(checkCalls()).toBe(1);
    await refreshTeamPolicy([vaultLock("a", 2)]);
    expect(checkCalls()).toBe(2);
  });

  it("logs a team document's issues under the team's name instead of toasting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.invoke.mockResolvedValueOnce({
      doc: { version: 1, policy: {}, defaults: {} },
      issues: [{ kind: "notForTeam", layer: "policy", key: "server.url", message: "machine policy only; ignored" }],
    });
    await refreshTeamPolicy([vaultLock("a")]);
    expect(warn).toHaveBeenCalledWith("[policy]", "policy.server.url", "Team a: machine policy only; ignored");
    warn.mockRestore();
  });

  it("account switch swaps the layer", async () => {
    expect(ACCOUNT_SCOPED_STORAGE_KEYS).toContain("voltius-team-policy");
    await refreshTeamPolicy([vaultLock("a")]);
    expect(lockedValue(ACTION).locked).toBe(true);

    const switchTo = async (from: string, to: string) => {
      parkAccountUiState(from);
      await clearAccountUiState();
      restoreAccountUiState(to);
      vi.resetModules();
      return import("@/stores/policyStore");
    };

    const asB = await switchTo("account-a", "account-b");
    expect(asB.lockedValue(ACTION)).toEqual({ locked: false });

    const asA = await switchTo("account-b", "account-a");
    expect(asA.lockedValue(ACTION)).toEqual({ locked: true, value: "vault", source: "server", teams: ["Team a"] });
  });

  it("sign-out clears the layer", async () => {
    await refreshTeamPolicy([vaultLock("a")]);
    expect(localStorage.getItem("voltius-team-policy")).not.toBeNull();
    await clearAccountUiState();
    expect(useTeamPolicyStore.getState().layer).toBeNull();
    expect(lockedValue(ACTION)).toEqual({ locked: false });
    expect(localStorage.getItem("voltius-team-policy")).toBeNull();
  });
});
