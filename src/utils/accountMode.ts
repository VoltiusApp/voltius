/**
 * Whether locking the vault means anything for this account. A no-password local
 * account keeps its key in the OS keychain, so autoLogin reopens the vault on the
 * next frame — offering the action there would just reload the window.
 */
export function canLockVault(mode: string | null): boolean {
  return mode === "local" || mode === "server";
}

/** Whether any lock is leavable for this account: by password, or by system authentication. */
export function canLockApp(mode: string | null, systemAuthUnlock: boolean): boolean {
  return canLockVault(mode) || (mode === "local-nopassword" && systemAuthUnlock);
}
