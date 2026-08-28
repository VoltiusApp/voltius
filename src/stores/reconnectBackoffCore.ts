import { isMissingUsernameError, isNoAuthError, isPassphraseError } from "@/components/terminal/connection-overlay/utils";
import type { VaultErrorCode } from "@/services/vaultErrors";

/**
 * A failure retrying cannot fix: the user must supply something, or the vault cannot
 * be read. Matched on the code, never the message — the message is translated.
 */
export function stopsRetrying(msg?: string, code?: VaultErrorCode): boolean {
  if (code) return true;
  return isPassphraseError(msg) || isNoAuthError(msg) || isMissingUsernameError(msg);
}

export function backoffDelays(): number[] {
  const delays = [1500, 3000, 5000, 8000];
  let total = delays.reduce((a, b) => a + b, 0);
  while (total < 180_000) {
    delays.push(10_000);
    total += 10_000;
  }
  return delays;
}

export type SessionStatus = "connected" | "connecting" | "disconnected" | "error" | undefined;

export interface BackoffStore {
  status(sessionId: string): SessionStatus;
  exists(sessionId: string): boolean;
  /** Steady "reconnecting" state held for the whole loop. Maps to 'connecting'
   * so the overlay shows the normal connection steps (TCP step spinning). */
  markReconnecting(sessionId: string): void;
  markConnected(sessionId: string): void;
  markError(sessionId: string, message: string, code?: VaultErrorCode): void;
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
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Reconnect a dropped session on the backoff schedule while holding a single
 * steady "reconnecting" state. Per-attempt failures are silent — the overlay
 * stays calm and never flashes a scary transient error. Only terminal outcomes
 * change state: success → connected, interactive-auth needed → error (prompt),
 * schedule exhausted → error (Retry/Dismiss). */
export async function runBackoff(sessionId: string, store: BackoffStore): Promise<boolean> {
  const gen = (generations.get(sessionId) ?? 0) + 1;
  generations.set(sessionId, gen);
  const superseded = () => generations.get(sessionId) !== gen;

  store.markReconnecting(sessionId);

  for (const delay of backoffDelays()) {
    await sleep(delay);
    if (superseded()) return false;
    if (!store.exists(sessionId)) return false;
    // Recovered through another path (e.g. a manual retry) — nothing to do.
    if (store.status(sessionId) === "connected") return true;

    const { ok, errorMessage, errorCode } = await store.attempt(sessionId);
    if (superseded()) return false;
    if (!store.exists(sessionId)) return false;
    if (ok) {
      store.markConnected(sessionId);
      return true;
    }
    // The session no longer exists on the host: terminal, tear down.
    if (errorMessage?.includes("SESSION_ENDED")) {
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
  }
  store.markError(sessionId, "Couldn't reconnect after repeated attempts");
  return false;
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
