import { isMissingUsernameError, isNoAuthError, isPassphraseError } from "@/components/terminal/connection-overlay/utils";
import type { VaultErrorCode } from "@/services/vaultErrors";
import type { TerminalSession } from "@/types";

/**
 * A failure retrying cannot fix: the user must supply something, or the vault cannot
 * be read. Matched on the code, never the message — the message is translated.
 */
export function stopsRetrying(msg?: string, code?: VaultErrorCode): boolean {
  if (code) return true;
  return isPassphraseError(msg) || isNoAuthError(msg) || isMissingUsernameError(msg) || isHostKeyRejected(msg);
}

// Retrying would re-open the host-key prompt the user just turned down.
function isHostKeyRejected(msg?: string): boolean {
  return !!msg?.includes("Connection aborted by user.");
}

export function isSessionEnded(msg?: string): boolean {
  return !!msg?.includes("SESSION_ENDED");
}

export const FAST_DELAYS_MS: readonly number[] = (() => {
  const delays = [1500, 3000, 5000, 8000];
  let total = delays.reduce((a, b) => a + b, 0);
  while (total < 180_000) {
    delays.push(10_000);
    total += 10_000;
  }
  return delays;
})();

export const SLOW_RETRY_MS = 30_000;

/** A tab that never connected gets these attempts when the network returns, then shows its error again. */
export const CATCH_UP_DELAYS_MS: readonly number[] = [300, 2000, 5000];

export function retryDelay(step: number): number {
  return FAST_DELAYS_MS[step] ?? SLOW_RETRY_MS;
}

export type SessionStatus = "connected" | "connecting" | "disconnected" | "error" | undefined;

export type ReconnectWait = NonNullable<TerminalSession["reconnectWait"]>;

export interface StrandableSession {
  type: string;
  status: SessionStatus;
  everConnected?: boolean;
  errorMessage?: string;
  errorCode?: VaultErrorCode;
}

/** An ssh tab showing a failure the network returning can fix. */
export function strandedByNetwork(s: StrandableSession): boolean {
  return (
    s.type === "ssh" &&
    s.status === "error" &&
    !isSessionEnded(s.errorMessage) &&
    !stopsRetrying(s.errorMessage, s.errorCode)
  );
}

export interface BackoffStore {
  status(sessionId: string): SessionStatus;
  exists(sessionId: string): boolean;
  /** Steady "reconnecting" state held for the whole loop. Maps to 'connecting'
   * so the overlay shows the normal connection steps (TCP step spinning). */
  markReconnecting(sessionId: string): void;
  markConnected(sessionId: string): void;
  markError(sessionId: string, message: string, code?: VaultErrorCode): void;
  setWait(sessionId: string, wait: ReconnectWait | undefined): void;
  online(sessionId: string): boolean;
  /** Silent connect attempt: mutates no visible status, returns the outcome. */
  attempt(sessionId: string): Promise<{ ok: boolean; errorMessage?: string; errorCode?: VaultErrorCode }>;
  /** The multiplexer session is gone on the host (attach-only probe failed):
   * tear the session down — retrying can never succeed. */
  sessionEnded(sessionId: string): void;
}

/** Per-session generation counter: a newer loop supersedes any older one. */
const generations = new Map<string, number>();

/** Cancel any live backoff loop for sessionId so it bails at its next check. */
export function cancelBackoff(sessionId: string): void {
  generations.set(sessionId, (generations.get(sessionId) ?? 0) + 1);
  wakeBackoff(sessionId);
}

const wakers = new Map<string, () => void>();

/** Resolves true when woken early by wakeBackoff, false when the delay elapsed. */
function sleep(sessionId: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      clearTimeout(timer);
      if (wakers.get(sessionId) === wake) wakers.delete(sessionId);
      resolve(true);
    };
    wakers.set(sessionId, wake);
    timer = setTimeout(() => {
      if (wakers.get(sessionId) === wake) wakers.delete(sessionId);
      resolve(false);
    }, ms);
  });
}

/** Cut the current wait of sessionId's loop short and restart its schedule. */
export function wakeBackoff(sessionId: string): boolean {
  const wake = wakers.get(sessionId);
  wake?.();
  return !!wake;
}

export function sleepingBackoffs(): string[] {
  return [...wakers.keys()];
}

/** Reconnect a dropped session while holding a single steady "reconnecting"
 * state. Per-attempt failures are silent; it never gives up on a transient
 * failure, and holds off while store.online says the link is down.
 * Terminal outcomes: success → connected, interactive-auth needed → error.
 * With `catchUp`, only those attempts are made and the last failure is shown. */
export async function runBackoff(
  sessionId: string,
  store: BackoffStore,
  catchUp?: readonly number[],
): Promise<boolean> {
  const delay = (step: number) => (catchUp ? catchUp[step] : retryDelay(step));
  const gen = (generations.get(sessionId) ?? 0) + 1;
  generations.set(sessionId, gen);
  const superseded = () => generations.get(sessionId) !== gen;

  store.markReconnecting(sessionId);
  store.setWait(sessionId, undefined);

  let step = 0;
  for (;;) {
    const woken = await sleep(sessionId, delay(step));
    if (superseded()) return false;
    if (!store.exists(sessionId)) return false;
    // Recovered through another path (e.g. a manual retry) — nothing to do.
    if (store.status(sessionId) === "connected") return true;
    if (woken) step = 0;
    if (!store.online(sessionId)) {
      store.setWait(sessionId, "offline");
      step = 0;
      continue;
    }

    const { ok, errorMessage, errorCode } = await store.attempt(sessionId);
    if (superseded()) return false;
    if (!store.exists(sessionId)) return false;
    if (ok) {
      store.markConnected(sessionId);
      return true;
    }
    // The session no longer exists on the host: terminal, tear down.
    if (isSessionEnded(errorMessage)) {
      store.sessionEnded(sessionId);
      return false;
    }
    // Nothing a retry can fix. The code must travel with the message, or the overlay
    // falls back to the generic panel.
    if (stopsRetrying(errorMessage, errorCode)) {
      store.markError(sessionId, errorMessage ?? "Authentication required", errorCode);
      return false;
    }
    // Transient failure (host unreachable, refused): stay reconnecting, retry.
    step++;
    if (catchUp && step >= catchUp.length) {
      store.markError(sessionId, errorMessage ?? "", errorCode);
      return false;
    }
    store.setWait(sessionId, !catchUp && retryDelay(step) === SLOW_RETRY_MS ? "slow" : undefined);
  }
}

/** Route a session whose channel just closed.
 *
 * ssh/serial: start the reconnect backoff, but ONLY when the session was still
 * 'connected'. A close arriving while we're already reconnecting — a duplicate
 * event, or the intentional disconnect performed inside an attempt — is ignored
 * so the steady overlay never flickers and no second loop spawns. The loop owns
 * the 'reconnecting' (connecting) state, so we don't set it here.
 *
 * `remoteExit` means the far side sent an exit-status/exit-signal before the
 * close: the shell ended on purpose (the user typed `exit`), not a dropped
 * link, so the session is over and reconnecting would resurrect it (#180).
 * Persistent sessions are excluded: their wrapper also exits on a tmux/screen
 * detach, so there the attach probe (SESSION_ENDED) stays the judge.
 *
 * Auto-reconnect turned off (serial devices that must release the port, #192):
 * the drop just marks the session disconnected, leaving the port free and the
 * reopen button armed.
 *
 * local: just mark disconnected (no reconnect). */
export function handleSessionClosed(
  sessionType: string,
  sessionId: string,
  deps: {
    status: (id: string) => SessionStatus;
    persist: (id: string) => boolean;
    autoReconnect: (id: string) => boolean;
    markDisconnected: (id: string) => void;
    reconnectWithBackoff: (id: string) => void;
    endSession: (id: string) => void;
  },
  remoteExit = false,
): void {
  if (sessionType !== "ssh" && sessionType !== "serial") {
    deps.markDisconnected(sessionId);
    return;
  }
  if (deps.status(sessionId) !== "connected") return;
  if (!deps.autoReconnect(sessionId)) {
    deps.markDisconnected(sessionId);
    return;
  }
  if (remoteExit && !deps.persist(sessionId)) {
    deps.endSession(sessionId);
    return;
  }
  deps.reconnectWithBackoff(sessionId);
}
