import {
  OBJECT_RULE_PERMISSIONS, overrideStateOf, ruleSubjectKey, ruleSubjectOf,
  type OverrideState, type Permission, type RuleEntry, type RuleSubject,
} from "@/services/permissions";

export interface RuleSetChange {
  subject: RuleSubject;
  bits: { permission: Permission; before: OverrideState; after: OverrideState }[];
}

const keyOf = (e: RuleEntry) => ruleSubjectKey(ruleSubjectOf(e));
const RANK: Record<RuleEntry["subject_type"], number> = { everyone: 0, role: 1, member: 2 };

export function describeRuleSetChange(from: RuleEntry[], to: RuleEntry[]): RuleSetChange[] {
  const before = new Map(from.map((e) => [keyOf(e), e]));
  const after = new Map(to.map((e) => [keyOf(e), e]));
  const entries = [...new Set([...before.keys(), ...after.keys()])]
    .map((key) => ({ was: before.get(key), now: after.get(key) }))
    .sort((a, b) => RANK[(a.now ?? a.was)!.subject_type] - RANK[(b.now ?? b.was)!.subject_type]);
  return entries.flatMap(({ was, now }) => {
    const bits = OBJECT_RULE_PERMISSIONS
      .map((permission) => ({
        permission,
        before: overrideStateOf(permission, was?.allow ?? 0, was?.deny ?? 0),
        after: overrideStateOf(permission, now?.allow ?? 0, now?.deny ?? 0),
      }))
      .filter((b) => b.before !== b.after);
    return bits.length === 0 ? [] : [{ subject: ruleSubjectOf((now ?? was)!), bits }];
  });
}
