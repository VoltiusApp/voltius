import { test, expect } from "vitest";
import { describeRuleSetChange } from "./ruleSetDiff";
import { PERM_BITS } from "./permissions";

test("lists only subjects and bits whose state changes", () => {
  const changes = describeRuleSetChange(
    [{ subject_type: "everyone", subject_id: null, allow: 0, deny: PERM_BITS.CONNECT }],
    [
      { subject_type: "everyone", subject_id: null, allow: 0, deny: PERM_BITS.CONNECT | PERM_BITS.VIEW },
      { subject_type: "role", subject_id: "r1", allow: PERM_BITS.CONNECT, deny: 0 },
    ],
  );
  expect(changes).toEqual([
    { subject: { type: "everyone" }, bits: [{ permission: "VIEW", before: "inherit", after: "deny" }] },
    { subject: { type: "role", roleId: "r1" }, bits: [{ permission: "CONNECT", before: "inherit", after: "allow" }] },
  ]);
});

test("member entries are not listed (spec: @everyone and each role)", () => {
  expect(describeRuleSetChange([], [{ subject_type: "member", subject_id: "u1", allow: 4, deny: 0 }])).toEqual([]);
});
