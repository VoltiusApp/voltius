import { OBJECT_RULE_PERMISSIONS, overrideStateOf, type OverrideState, type Permission, type RuleEntry } from "@/services/permissions";

export interface RuleSetChange {
  subject: { type: "everyone" } | { type: "role"; roleId: string };
  bits: { permission: Permission; before: OverrideState; after: OverrideState }[];
}

const keyOf = (e: RuleEntry) => `${e.subject_type}:${e.subject_id ?? ""}`;

export function describeRuleSetChange(from: RuleEntry[], to: RuleEntry[]): RuleSetChange[] {
  const listed = (e: RuleEntry) => e.subject_type !== "member";
  const before = new Map(from.filter(listed).map((e) => [keyOf(e), e]));
  const after = new Map(to.filter(listed).map((e) => [keyOf(e), e]));
  const subjects = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) =>
    (a.startsWith("everyone") ? 0 : 1) - (b.startsWith("everyone") ? 0 : 1));
  return subjects.flatMap((key) => {
    const was = before.get(key);
    const now = after.get(key);
    const bits = OBJECT_RULE_PERMISSIONS
      .map((permission) => ({
        permission,
        before: overrideStateOf(permission, was?.allow ?? 0, was?.deny ?? 0),
        after: overrideStateOf(permission, now?.allow ?? 0, now?.deny ?? 0),
      }))
      .filter((b) => b.before !== b.after);
    if (bits.length === 0) return [];
    const entry = (now ?? was)!;
    const subject = entry.subject_type === "everyone"
      ? { type: "everyone" as const }
      : { type: "role" as const, roleId: entry.subject_id! };
    return [{ subject, bits }];
  });
}
