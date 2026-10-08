import { invoke } from "@/lib/invoke";
import { getAccountMode, lockVaultSession } from "@/services/account";
import { getEffectiveLockSettings } from "@/hooks/useEffectiveLockSettings";
import { useAppLockStore } from "@/stores/appLockStore";
import { useSecurityStore } from "@/stores/securityStore";
import { canLockApp, canLockVault } from "@/utils/accountMode";
import { withLeaveLockSuppressed } from "@/services/leaveLockSuppression";

export type VerifyOutcome = "ok" | "cancelled" | "failed" | "unavailable";

export function systemAuthAvailable(): Promise<boolean> {
  return invoke<boolean>("system_auth_available").catch(() => false);
}

export function systemAuthVerify(reason: string): Promise<VerifyOutcome> {
  return withLeaveLockSuppressed(() =>
    invoke<VerifyOutcome>("system_auth_verify", { reason }).catch(() => "failed" as const),
  );
}

export async function lockApp(): Promise<void> {
  const { systemAuthUnlock } = useSecurityStore.getState();
  const { lockAction } = getEffectiveLockSettings();
  const mode = await getAccountMode().catch(() => null);
  if (!canLockApp(mode, systemAuthUnlock)) return;
  if (!canLockVault(mode) && !(await systemAuthAvailable())) return;
  if (lockAction === "vault" && canLockVault(mode)) {
    try {
      await lockVaultSession({ keepKeychainEntry: systemAuthUnlock });
    } finally {
      window.location.reload();
    }
    return;
  }
  await useAppLockStore.getState().lockScreen();
}

export function setHideInRecents(on: boolean): Promise<void> {
  return invoke<void>("app_lock_hide_in_recents", { on }).catch(() => {});
}
