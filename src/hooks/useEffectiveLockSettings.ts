import { useMemo } from "react";
import { lockActionSetting, sessionTimeoutSetting, type LockAction } from "@/stores/securityStore";
import { policySourceOf, usePolicyStore } from "@/stores/policyStore";

export interface LockLimit {
  teams: { timeout: string[]; vault: string[] };
}

export interface EffectiveLockSettings {
  sessionTimeoutMinutes: number | null;
  lockAction: LockAction;
  limit: LockLimit | null;
}

const TIMEOUT_KEY = sessionTimeoutSetting.key;
const ACTION_KEY = lockActionSetting.key;

function readLimit(): LockLimit | null {
  if (!policySourceOf(TIMEOUT_KEY) && !policySourceOf(ACTION_KEY)) return null;
  const teamsOf = (key: string) => policySourceOf(key)?.teams ?? [];
  return { teams: { timeout: teamsOf(TIMEOUT_KEY), vault: teamsOf(ACTION_KEY) } };
}

export function getEffectiveLockSettings(): EffectiveLockSettings {
  return {
    sessionTimeoutMinutes: sessionTimeoutSetting.get(),
    lockAction: lockActionSetting.get(),
    limit: readLimit(),
  };
}

export function useEffectiveLockSettings(): EffectiveLockSettings {
  const sessionTimeoutMinutes = sessionTimeoutSetting.use();
  const lockAction = lockActionSetting.use();
  const signature = usePolicyStore(() => JSON.stringify(readLimit()));
  const limit = useMemo<LockLimit | null>(() => JSON.parse(signature), [signature]);
  return useMemo(() => ({ sessionTimeoutMinutes, lockAction, limit }), [sessionTimeoutMinutes, lockAction, limit]);
}
