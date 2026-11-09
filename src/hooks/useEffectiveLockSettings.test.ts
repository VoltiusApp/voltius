// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSecurityStore } from "@/stores/securityStore";
import { resetPolicy, withPolicy, withTeamPolicy } from "@/test/policy";
import { getEffectiveLockSettings, useEffectiveLockSettings } from "./useEffectiveLockSettings";

const MAX_15 = { "security.lockTimeoutMinutes": { $range: { max: 15 } } };
const own = (sessionTimeoutMinutes: number | null, lockAction: "screen" | "vault" = "screen") =>
  useSecurityStore.setState({ sessionTimeoutMinutes, lockAction });

beforeEach(() => {
  own(null);
  resetPolicy();
});

test("without a policy the member's own settings apply", () => {
  expect(getEffectiveLockSettings()).toEqual({ sessionTimeoutMinutes: null, lockAction: "screen", limit: null });
});

test("never under a team max of 15 becomes 15", () => {
  withTeamPolicy(MAX_15);
  expect(getEffectiveLockSettings().sessionTimeoutMinutes).toBe(15);
});

test("an own timeout under the max is kept", () => {
  withTeamPolicy(MAX_15);
  own(5);
  expect(getEffectiveLockSettings().sessionTimeoutMinutes).toBe(5);
});

test("an own timeout over the max is clamped", () => {
  withTeamPolicy(MAX_15);
  own(30);
  expect(getEffectiveLockSettings().sessionTimeoutMinutes).toBe(15);
});

test("a forced vault overrides the chosen screen lock", () => {
  withTeamPolicy({ "security.lockAction": "vault" });
  expect(getEffectiveLockSettings().lockAction).toBe("vault");
});

test("a machine policy can set the timeout max too", () => {
  withPolicy(MAX_15);
  own(60);
  expect(getEffectiveLockSettings()).toMatchObject({
    sessionTimeoutMinutes: 15,
    limit: { teams: { timeout: [], vault: [] } },
  });
});

test("a limit names the teams and the stored preference is not rewritten", () => {
  withTeamPolicy({ ...MAX_15, "security.lockAction": "vault" });
  const { result } = renderHook(() => useEffectiveLockSettings());
  expect(result.current.sessionTimeoutMinutes).toBe(15);
  expect(result.current.lockAction).toBe("vault");
  expect(result.current.limit).toEqual({ teams: { timeout: ["Acme"], vault: ["Acme"] } });
  expect(useSecurityStore.getState().sessionTimeoutMinutes).toBeNull();
  expect(useSecurityStore.getState().lockAction).toBe("screen");
});
