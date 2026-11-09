import { expect, test } from "vitest";
import { lockPolicyDoc } from "./lockPolicy";

test("a team lock policy becomes a range and, when forced, a vault lock", () => {
  expect(lockPolicyDoc({ max_minutes: 15, force_vault: false })).toEqual({ "security.lockTimeoutMinutes": { $range: { max: 15 } } });
  expect(lockPolicyDoc({ max_minutes: 0, force_vault: true })).toEqual({
    "security.lockTimeoutMinutes": { $range: { max: 0 } },
    "security.lockAction": "vault",
  });
});
