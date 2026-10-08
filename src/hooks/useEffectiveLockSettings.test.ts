// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSecurityStore } from "@/stores/securityStore";
import { useOrgLockPolicyStore } from "@/stores/orgLockPolicyStore";
import { getEffectiveLockSettings, useEffectiveLockSettings } from "./useEffectiveLockSettings";

beforeEach(() => {
  useSecurityStore.setState({ sessionTimeoutMinutes: null, lockAction: "screen" });
  useOrgLockPolicyStore.setState({ policy: null });
});

test("without a policy the member's own settings apply", () => {
  expect(getEffectiveLockSettings()).toEqual({ sessionTimeoutMinutes: null, lockAction: "screen", policy: null });
});

test("a policy clamps without rewriting the stored preference", () => {
  useOrgLockPolicyStore.setState({ policy: { maxMinutes: 15, forceVault: true } });
  const { result } = renderHook(() => useEffectiveLockSettings());
  expect(result.current.sessionTimeoutMinutes).toBe(15);
  expect(result.current.lockAction).toBe("vault");
  expect(useSecurityStore.getState().sessionTimeoutMinutes).toBeNull();
  expect(useSecurityStore.getState().lockAction).toBe("screen");
});
