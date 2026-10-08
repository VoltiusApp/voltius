import { useMemo } from "react";
import { effectiveLockAction, effectiveTimeout, type LockPolicy } from "@/services/lockPolicy";
import { useOrgLockPolicyStore } from "@/stores/orgLockPolicyStore";
import { useSecurityStore, type LockAction } from "@/stores/securityStore";

export interface EffectiveLockSettings {
  sessionTimeoutMinutes: number | null;
  lockAction: LockAction;
  policy: LockPolicy | null;
}

function resolve(minutes: number | null, action: LockAction, policy: LockPolicy | null): EffectiveLockSettings {
  return {
    sessionTimeoutMinutes: effectiveTimeout(minutes, policy),
    lockAction: effectiveLockAction(action, policy),
    policy,
  };
}

export function getEffectiveLockSettings(): EffectiveLockSettings {
  const { sessionTimeoutMinutes, lockAction } = useSecurityStore.getState();
  return resolve(sessionTimeoutMinutes, lockAction, useOrgLockPolicyStore.getState().policy);
}

export function useEffectiveLockSettings(): EffectiveLockSettings {
  const minutes = useSecurityStore((s) => s.sessionTimeoutMinutes);
  const action = useSecurityStore((s) => s.lockAction);
  const policy = useOrgLockPolicyStore((s) => s.policy);
  return useMemo(() => resolve(minutes, action, policy), [minutes, action, policy]);
}
