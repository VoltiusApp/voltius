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
    { subject: { type: "role", id: "r1" }, bits: [{ permission: "CONNECT", before: "inherit", after: "allow" }] },
  ]);
});

test("a per-member rule that differs between sets is listed after @everyone and roles", () => {
  const changes = describeRuleSetChange(
    [{ subject_type: "member", subject_id: "u1", allow: 0, deny: PERM_BITS.VIEW }],
    [{ subject_type: "role", subject_id: "r1", allow: PERM_BITS.CONNECT, deny: 0 }],
  );
  expect(changes.map((c) => c.subject)).toEqual([{ type: "role", id: "r1" }, { type: "member", id: "u1" }]);
  expect(changes[1].bits).toEqual([{ permission: "VIEW", before: "deny", after: "inherit" }]);
});

test("identical member rules on both sides are not a change", () => {
  const same = [{ subject_type: "member" as const, subject_id: "u1", allow: 0, deny: PERM_BITS.VIEW }];
  expect(describeRuleSetChange(same, same)).toEqual([]);
});
