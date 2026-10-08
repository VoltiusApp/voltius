import type { Team } from "@/services/teamService";
import type { LockAction } from "@/stores/securityStore";

export interface LockPolicy {
  maxMinutes: number;
  forceVault: boolean;
}

export function combineLockPolicies(teams: Pick<Team, "lock_policy">[]): LockPolicy | null {
  let out: LockPolicy | null = null;
  for (const { lock_policy: p } of teams) {
    if (!p) continue;
    out = out
      ? { maxMinutes: Math.min(out.maxMinutes, p.max_minutes), forceVault: out.forceVault || p.force_vault }
      : { maxMinutes: p.max_minutes, forceVault: p.force_vault };
  }
  return out;
}

export function effectiveTimeout(own: number | null, policy: LockPolicy | null): number | null {
  if (!policy) return own;
  return own === null ? policy.maxMinutes : Math.min(own, policy.maxMinutes);
}

export function effectiveLockAction(own: LockAction, policy: LockPolicy | null): LockAction {
  return policy?.forceVault ? "vault" : own;
}

export function timeoutAllowed(minutes: number | null, policy: LockPolicy | null): boolean {
  return !policy || (minutes !== null && minutes <= policy.maxMinutes);
}

export function policyTeamNames(
  teams: Pick<Team, "name" | "lock_policy">[],
  policy: LockPolicy,
): { timeout: string[]; vault: string[] } {
  return {
    timeout: teams.filter((t) => t.lock_policy?.max_minutes === policy.maxMinutes).map((t) => t.name),
    vault: teams.filter((t) => t.lock_policy?.force_vault).map((t) => t.name),
  };
}
