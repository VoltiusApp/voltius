import type { PolicyIssue, PolicySource } from "@/stores/policyStore";
import { inPolicyRange, rangeOf, type PolicyRange } from "./range";

export interface TeamPolicyInput {
  teamId: string;
  teamName: string;
  joinedAt: string;
  policy: Record<string, unknown>;
}

export interface MergedLayer {
  policy: Record<string, unknown>;
  teams: Record<string, string[]>;
  issues: PolicyIssue[];
}

type Combined = { value: unknown; from: "earlier" | "later" | "both"; conflict: boolean };

export function intersectRanges(a: PolicyRange, b: PolicyRange): PolicyRange | null {
  const out: PolicyRange = {};
  const min = a.min === undefined ? b.min : b.min === undefined ? a.min : Math.max(a.min, b.min);
  const max = a.max === undefined ? b.max : b.max === undefined ? a.max : Math.min(a.max, b.max);
  if (min !== undefined) out.min = min;
  if (max !== undefined) out.max = max;
  if (min !== undefined && max !== undefined && min > max) return null;
  const allowed = a.allowed && b.allowed ? a.allowed.filter((v) => b.allowed!.includes(v)) : (a.allowed ?? b.allowed);
  if (allowed !== undefined) {
    if (allowed.length === 0) return null;
    out.allowed = allowed;
  }
  return out;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function combineEntry(earlier: unknown, later: unknown): Combined {
  if (earlier === undefined) return { value: later, from: "later", conflict: false };
  const er = rangeOf(earlier);
  const lr = rangeOf(later);
  if (!er) return { value: earlier, from: "earlier", conflict: lr ? !inPolicyRange(lr, earlier) : !sameValue(earlier, later) };
  if (!lr) {
    return inPolicyRange(er, later)
      ? { value: later, from: "later", conflict: false }
      : { value: earlier, from: "earlier", conflict: true };
  }
  const merged = intersectRanges(er, lr);
  return merged
    ? { value: { $range: merged }, from: "both", conflict: false }
    : { value: earlier, from: "earlier", conflict: true };
}

interface Entry {
  value: unknown;
  names: string[];
  from: Combined["from"];
}

const label = (names: string[]) => (names.length ? names.join(" and ") : "machine policy");

function foldLayer(
  acc: Record<string, Entry>,
  layer: Record<string, unknown>,
  namesFor: (key: string) => string[],
  issues: PolicyIssue[],
): void {
  for (const [key, later] of Object.entries(layer)) {
    const laterNames = namesFor(key);
    const prev = acc[key];
    const res = combineEntry(prev?.value, later);
    if (res.conflict) {
      issues.push({
        kind: "conflict",
        layer: "policy",
        key,
        message: `${label(prev.names)} and ${label(laterNames)} disagree on "${key}"; ${label(prev.names)} wins`,
      });
    }
    const names = res.from === "earlier" ? prev.names : res.from === "later" ? laterNames : [...prev.names, ...laterNames];
    acc[key] = { value: res.value, names, from: res.from };
  }
}

export function mergeTeamDocs(docs: TeamPolicyInput[]): MergedLayer {
  const sorted = [...docs].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.teamId.localeCompare(b.teamId));
  const acc: Record<string, Entry> = {};
  const issues: PolicyIssue[] = [];
  for (const d of sorted) foldLayer(acc, d.policy, () => [d.teamName], issues);
  return {
    policy: Object.fromEntries(Object.entries(acc).map(([k, e]) => [k, e.value])),
    teams: Object.fromEntries(Object.entries(acc).map(([k, e]) => [k, e.names])),
    issues,
  };
}

export function mergeMachineAndTeam(
  machine: Record<string, unknown>,
  team: MergedLayer,
): { policy: Record<string, unknown>; sources: Record<string, { source: PolicySource; teams: string[] }>; issues: PolicyIssue[] } {
  const acc: Record<string, Entry> = {};
  const issues: PolicyIssue[] = [];
  for (const [key, value] of Object.entries(machine)) acc[key] = { value, names: [], from: "earlier" };
  foldLayer(acc, team.policy, (key) => team.teams[key] ?? [], issues);
  const entries = Object.entries(acc);
  return {
    policy: Object.fromEntries(entries.map(([k, e]) => [k, e.value])),
    sources: Object.fromEntries(
      entries.map(([k, e]) => [k, { source: e.from === "later" ? "server" : "machine", teams: e.names } as const]),
    ),
    issues,
  };
}
