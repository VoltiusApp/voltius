import type { TeamLockPolicy } from "@/services/teamService";

export function lockPolicyDoc(lp: TeamLockPolicy): Record<string, unknown> {
  return {
    "security.lockTimeoutMinutes": { $range: { max: lp.max_minutes } },
    ...(lp.force_vault ? { "security.lockAction": "vault" } : {}),
  };
}
