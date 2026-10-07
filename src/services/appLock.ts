import { invoke } from "@/lib/invoke";
import { getAccountMode, lockVaultSession } from "@/services/account";
import { useAppLockStore } from "@/stores/appLockStore";
import { useSecurityStore } from "@/stores/securityStore";
import { canLockApp, canLockVault } from "@/utils/accountMode";

export type VerifyOutcome = "ok" | "cancelled" | "failed" | "unavailable";

let leaveLockSuppressions = 0;

export function isLeaveLockSuppressed(): boolean {
  return leaveLockSuppressions > 0;
}

/** For work that sends the user to a system screen of our own making (auth prompt, file picker). */
export async function withLeaveLockSuppressed<T>(work: () => Promise<T>): Promise<T> {
  leaveLockSuppressions++;
  try {
    return await work();
  } finally {
    leaveLockSuppressions--;
  }
}

export function systemAuthAvailable(): Promise<boolean> {
  return invoke<boolean>("system_auth_available").catch(() => false);
}

export function systemAuthVerify(reason: string): Promise<VerifyOutcome> {
  return withLeaveLockSuppressed(() =>
    invoke<VerifyOutcome>("system_auth_verify", { reason }).catch(() => "failed" as const),
  );
}

export async function lockApp(): Promise<void> {
  const { lockAction, systemAuthUnlock } = useSecurityStore.getState();
  const mode = await getAccountMode().catch(() => null);
  if (!canLockApp(mode, systemAuthUnlock)) return;
  if (lockAction === "vault" && canLockVault(mode)) {
    await lockVaultSession({ keepKeychainEntry: systemAuthUnlock });
    window.location.reload();
    return;
  }
  await useAppLockStore.getState().lockScreen();
}
