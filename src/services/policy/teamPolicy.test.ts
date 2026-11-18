// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), version: vi.fn() }));
vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@/services/clientHeaders", () => ({ clientVersion: mocks.version }));
vi.mock("@/services/lanSync", () => ({ clearLanSyncScopes: async () => {} }));

import { refreshTeamPolicy, teamDocsFrom } from "./teamPolicy";
import { lockedValue, onPolicyLoaded, policyRange } from "@/stores/policyStore";
import { useEnrolledTeamStore } from "@/stores/enrolledTeamStore";
import { useTeamPolicyStore } from "@/stores/teamPolicyStore";
import { ACCOUNT_SCOPED_STORAGE_KEYS, parkAccountUiState, restoreAccountUiState } from "@/stores/persistedAccountUiState";
import { clearAccountUiState } from "@/services/vault";
import { echoTeamDoc, enrollmentTokenText, resetPolicy, withEnrolledTeam, withPolicy } from "@/test/policy";
import { makeTeam as team } from "@/test/team";
import { LOCK_ACTION_KEY as ACTION, LOCK_TIMEOUT_KEY as TIMEOUT } from "@/services/lockPolicy";


const vaultLock = (id: string, revision = 1) =>
  team(id, { policy: { version: 1, policy: { [ACTION]: "vault" } }, policy_revision: revision, joined_at: "2026-01-01T00:00:00Z" });

const checkCalls = () => mocks.invoke.mock.calls.filter(([cmd]) => cmd === "policy_check_team_doc").length;

describe("team policy", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(echoTeamDoc);
    mocks.version.mockResolvedValue("0.66.0");
    resetPolicy();
  });

  it("old server: lock_policy without policy field becomes the two app-lock keys", async () => {
    const old = team("a", { lock_policy: { max_minutes: 15, force_vault: true } });
    expect(teamDocsFrom([old]).map((d) => JSON.parse(d.text))).toEqual([
      { version: 1, policy: { [TIMEOUT]: { $range: { max: 15 } }, [ACTION]: "vault" } },
    ]);
    await refreshTeamPolicy([old]);
    expect(policyRange(TIMEOUT)).toEqual({ max: 15 });
    expect(lockedValue(ACTION)).toEqual({ locked: true, value: "vault", source: "server", teams: ["a"] });
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

  it("an app upgrade re-validates the cached documents", async () => {
    await refreshTeamPolicy([vaultLock("a")]);
    mocks.version.mockResolvedValue("0.67.0");
    await refreshTeamPolicy([vaultLock("a")]);
    expect(checkCalls()).toBe(2);
  });

  const holdChecks = () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mocks.invoke.mockImplementation(async (cmd: string, args?: unknown) => {
      await gate;
      return echoTeamDoc(cmd, args);
    });
    return release;
  };

  it("an older refresh landing after a newer unchanged one is dropped", async () => {
    await refreshTeamPolicy([vaultLock("a")]);
    const release = holdChecks();
    const stale = refreshTeamPolicy([vaultLock("a"), team("b", { policy: { version: 1, policy: { [TIMEOUT]: { $range: { max: 5 } } } } })]);
    await refreshTeamPolicy([vaultLock("a")]);
    release();
    await stale;
    expect(useTeamPolicyStore.getState().layer?.policy).toEqual({ [ACTION]: "vault" });
  });

  it("a refresh still validating when the account is cleared does not bring the layer back", async () => {
    const release = holdChecks();
    const pending = refreshTeamPolicy([vaultLock("a")]);
    await vi.waitFor(() => expect(checkCalls()).toBe(1));
    await clearAccountUiState();
    release();
    await pending;
    expect(useTeamPolicyStore.getState().layer).toBeNull();
    expect(lockedValue(ACTION)).toEqual({ locked: false });
  });

  it("logs a team document's issues under the team's name instead of toasting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.invoke.mockResolvedValueOnce({
      doc: { version: 1, policy: {}, defaults: {} },
      issues: [{ kind: "notForTeam", layer: "policy", key: "server.url", message: "machine policy only; ignored" }],
    });
    await refreshTeamPolicy([vaultLock("a")]);
    expect(warn).toHaveBeenCalledWith("[policy]", "policy.server.url", "a: machine policy only; ignored");
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
    expect(asA.lockedValue(ACTION)).toEqual({ locked: true, value: "vault", source: "server", teams: ["a"] });
  });

  it("sign-out clears the layer", async () => {
    await refreshTeamPolicy([vaultLock("a")]);
    expect(localStorage.getItem("voltius-team-policy")).not.toBeNull();
    await clearAccountUiState();
    expect(useTeamPolicyStore.getState().layer).toBeNull();
    expect(lockedValue(ACTION)).toEqual({ locked: false });
    expect(localStorage.getItem("voltius-team-policy")).toBeNull();
  });

  describe("with an enrolling team", () => {
    const timeoutCap = (id: string) =>
      team(id, { policy: { version: 1, policy: { [TIMEOUT]: { $range: { max: 5 } } } }, joined_at: "2026-02-01T00:00:00Z" });

    beforeEach(() => {
      withPolicy({ "enrollment.token": enrollmentTokenText() });
      withEnrolledTeam({ [ACTION]: "vault" }, "a");
    });

    it("skips the account's copy of the enrolling team and lists it once", async () => {
      await refreshTeamPolicy([vaultLock("a"), timeoutCap("b")]);
      expect(checkCalls()).toBe(1);
      expect(useTeamPolicyStore.getState().layer?.policy).toEqual({ [TIMEOUT]: { $range: { max: 5 } } });
      expect(lockedValue(ACTION)).toEqual({ locked: true, value: "vault", source: "server", teams: ["a"] });
      expect(policyRange(TIMEOUT)).toEqual({ max: 5 });
    });

    it("a change of enrolling team re-runs the account layer", async () => {
      await refreshTeamPolicy([vaultLock("a"), timeoutCap("b")]);
      useEnrolledTeamStore.getState().setEntry(null);
      await refreshTeamPolicy([vaultLock("a"), timeoutCap("b")]);
      expect(checkCalls()).toBe(3);
      expect(useTeamPolicyStore.getState().layer?.policy).toEqual({ [ACTION]: "vault", [TIMEOUT]: { $range: { max: 5 } } });
    });

    it("an account switch keeps the enrolling team's locks with no gap", async () => {
      await refreshTeamPolicy([timeoutCap("b")]);
      const seen: boolean[] = [];
      const off = onPolicyLoaded(() => seen.push(lockedValue(ACTION).locked));
      const unsub = useTeamPolicyStore.subscribe(() => seen.push(lockedValue(ACTION).locked));
      await clearAccountUiState();
      off();
      unsub();
      expect(useTeamPolicyStore.getState().layer).toBeNull();
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every(Boolean)).toBe(true);
      expect(policyRange(TIMEOUT)).toBeUndefined();
      expect(lockedValue(ACTION)).toEqual({ locked: true, value: "vault", source: "server", teams: ["a"] });
    });
  });
});
