import type { TeamLockPolicy } from "@/services/teamService";

export const LOCK_TIMEOUT_KEY = "security.lockTimeoutMinutes";

export function lockPolicyDoc(lp: TeamLockPolicy): Record<string, unknown> {
  return {
    [LOCK_TIMEOUT_KEY]: { $range: { max: lp.max_minutes } },
    ...(lp.force_vault ? { "security.lockAction": "vault" } : {}),
  };
}
