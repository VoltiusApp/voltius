/**
 * Login-sync readiness gate.
 *
 * Resolves immediately for local/offline users; SplashScreen holds it pending
 * while syncOnLogin / syncOnLoginReplace runs, so nothing that needs the
 * account's own data races the merge.
 *
 * Replace-mode is called out separately because it follows a wiped config dir:
 * an account switch deletes every entity file, so until this settles the app
 * knows of no connections at all — which is not the same as owning none.
 */

let resolveReady: (() => void) | null = null;
let ready: Promise<void> = Promise.resolve();
let replacePending = false;

export function setLoginSyncPending(options?: { replace?: boolean }): void {
  replacePending = options?.replace ?? false;
  ready = new Promise<void>((resolve) => { resolveReady = resolve; });
}

export function resolveLoginSync(): void {
  replacePending = false;
  resolveReady?.();
  resolveReady = null;
}

export function whenLoginSyncSettled(): Promise<void> {
  return ready;
}

/** True while a wiped local cache is still waiting to be refilled from the cloud. */
export function isReplaceSyncPending(): boolean {
  return replacePending;
}
