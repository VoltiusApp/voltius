import { invoke } from "@/lib/invoke";
import { getAccountMode, lockVaultSession, type LockKind } from "@/services/account";
import { getEffectiveLockSettings } from "@/hooks/useEffectiveLockSettings";
import { useAppLockStore } from "@/stores/appLockStore";
import { useSecurityStore } from "@/stores/securityStore";
import { canLockApp, canLockVault } from "@/utils/accountMode";
import { withLeaveLockSuppressed } from "@/services/leaveLockSuppression";
import { IMMEDIATELY } from "@/utils/sessionTimeout";

export type VerifyOutcome = "ok" | "cancelled" | "failed" | "unavailable";

export function systemAuthAvailable(): Promise<boolean> {
  return invoke<boolean>("system_auth_available").catch(() => false);
}

export function systemAuthVerify(reason: string): Promise<VerifyOutcome> {
  return withLeaveLockSuppressed(() =>
    invoke<VerifyOutcome>("system_auth_verify", { reason }).catch(() => "failed" as const),
  );
}

async function lockKind(): Promise<LockKind | null> {
  const { systemAuthUnlock } = useSecurityStore.getState();
  const { lockAction } = getEffectiveLockSettings();
  const mode = await getAccountMode().catch(() => null);
  if (!canLockApp(mode, systemAuthUnlock)) return null;
  if (!canLockVault(mode) && !(await systemAuthAvailable())) return null;
  return lockAction === "vault" && canLockVault(mode) ? "vault" : "screen";
}

async function engage(kind: LockKind): Promise<void> {
  if (kind === "screen") return useAppLockStore.getState().lockScreen();
  await lockVaultSession({ keepKeychainEntry: useSecurityStore.getState().systemAuthUnlock });
}

export async function lockApp(): Promise<void> {
  const kind = await lockKind();
  if (!kind) return;
  if (kind === "screen") return engage(kind);
  try {
    await engage(kind);
  } finally {
    window.location.reload();
  }
}

export function recordLastActive(at: number): Promise<void> {
  return invoke<void>("app_lock_touch", { at }).catch(() => {});
}

async function idleSinceLastRun(): Promise<boolean> {
  const { sessionTimeoutMinutes: minutes } = getEffectiveLockSettings();
  if (minutes === null || minutes < 0) return false;
  if (minutes === IMMEDIATELY) return true;
  const last = await invoke<number | null>("app_lock_last_active").catch(() => null);
  if (last === null) return true;
  const idle = Date.now() - last;
  return idle < 0 || idle >= minutes * 60_000;
}

const LAUNCH_CHECKED_KEY = "voltius.launch-lock-checked";

/** A killed app never saw its timeout fire, so a fresh launch past it starts locked. Reloads skip this. */
export async function lockOnLaunchIfIdle(): Promise<LockKind | null> {
  if (sessionStorage.getItem(LAUNCH_CHECKED_KEY)) return null;
  sessionStorage.setItem(LAUNCH_CHECKED_KEY, "1");
  if (!(await idleSinceLastRun())) return null;
  const kind = await lockKind();
  if (kind) await engage(kind);
  return kind;
}

export function setHideInRecents(on: boolean): Promise<void> {
  return invoke<void>("app_lock_hide_in_recents", { on }).catch(() => {});
}
