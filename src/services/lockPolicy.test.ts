import { describe, expect, test } from "vitest";
import {
  combineLockPolicies, effectiveLockAction, effectiveTimeout, policyTeamNames, timeoutAllowed,
} from "./lockPolicy";

const team = (name: string, lock_policy: { max_minutes: number; force_vault: boolean } | null | undefined) =>
  ({ name, lock_policy });

describe("combineLockPolicies", () => {
  test("no team has a policy", () => {
    expect(combineLockPolicies([])).toBeNull();
    expect(combineLockPolicies([team("A", null), team("B", undefined)])).toBeNull();
  });

  test("strictest timeout and any forced vault win", () => {
    expect(combineLockPolicies([
      team("A", { max_minutes: 30, force_vault: false }),
      team("B", null),
      team("C", { max_minutes: 15, force_vault: true }),
    ])).toEqual({ maxMinutes: 15, forceVault: true });
  });

  test("Immediately beats any number", () => {
    expect(combineLockPolicies([
      team("A", { max_minutes: 5, force_vault: false }),
      team("B", { max_minutes: 0, force_vault: false }),
    ])).toEqual({ maxMinutes: 0, forceVault: false });
  });
});

describe("effectiveTimeout", () => {
  const p = { maxMinutes: 15, forceVault: false };
  test.each([
    [null, null, null],
    [30, null, 30],
    [null, p, 15],
    [30, p, 15],
    [5, p, 5],
    [0, p, 0],
  ])("own %s with policy %o → %s", (own, policy, want) => {
    expect(effectiveTimeout(own, policy)).toBe(want);
  });
});

test("effectiveLockAction forces vault only when the policy says so", () => {
  expect(effectiveLockAction("screen", null)).toBe("screen");
  expect(effectiveLockAction("screen", { maxMinutes: 15, forceVault: false })).toBe("screen");
  expect(effectiveLockAction("screen", { maxMinutes: 15, forceVault: true })).toBe("vault");
});

test("timeoutAllowed hides Never and anything longer than the max", () => {
  const p = { maxMinutes: 15, forceVault: false };
  expect(timeoutAllowed(null, null)).toBe(true);
  expect(timeoutAllowed(null, p)).toBe(false);
  expect(timeoutAllowed(30, p)).toBe(false);
  expect(timeoutAllowed(15, p)).toBe(true);
  expect(timeoutAllowed(0, p)).toBe(true);
});

test("policyTeamNames names the teams that set the binding rules", () => {
  const teams = [
    team("Acme", { max_minutes: 15, force_vault: false }),
    team("Ops", { max_minutes: 30, force_vault: true }),
    team("Free", null),
  ];
  expect(policyTeamNames(teams, { maxMinutes: 15, forceVault: true })).toEqual({ timeout: ["Acme"], vault: ["Ops"] });
});
