import type { TeamLockPolicy } from "@/services/teamService";

export const LOCK_TIMEOUT_KEY = "security.lockTimeoutMinutes";
export const LOCK_ACTION_KEY = "security.lockAction";

export function lockPolicyDoc(lp: TeamLockPolicy): Record<string, unknown> {
  return {
    [LOCK_TIMEOUT_KEY]: { $range: { max: lp.max_minutes } },
    ...(lp.force_vault ? { [LOCK_ACTION_KEY]: "vault" } : {}),
  };
}
