/**
 * Whether locking the vault means anything for this account. A no-password local
 * account keeps its key in the OS keychain, so autoLogin reopens the vault on the
 * next frame — offering the action there would just reload the window.
 */
export function canLockVault(mode: string | null): boolean {
  return mode === "local" || mode === "server";
}

export type NoAccountMode = "local" | "local-nopassword";

/** A vault with no cloud account: the modes that pair over the local network. */
export function isNoAccountMode(mode: string | null | undefined): mode is NoAccountMode {
  return mode === "local" || mode === "local-nopassword";
}

/** Whether any lock is leavable for this account: by password, or by system authentication. */
export function canLockApp(mode: string | null, systemAuthUnlock: boolean): boolean {
  return canLockVault(mode) || (mode === "local-nopassword" && systemAuthUnlock);
}

const modeListeners = new Set<() => void>();

export function notifyAccountModeChanged(): void {
  modeListeners.forEach((listener) => listener());
}

export function subscribeAccountMode(listener: () => void): () => void {
  modeListeners.add(listener);
  return () => modeListeners.delete(listener);
}
