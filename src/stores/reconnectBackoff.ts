import { useSessionStore } from "./sessionStore";
import { isMissingUsernameError, isNoAuthError, isPassphraseError } from "@/components/terminal/connection-overlay/utils";
import { type BackoffStore, runBackoff } from "./reconnectBackoffCore";

/** A failed reconnect whose error needs the user (passphrase, username, auth
 * method) must not be retried — the overlay shows an interactive prompt. Reuses
 * the same predicates ConnectionOverlay renders against. */
function needsInteractiveInput(msg?: string): boolean {
  return isPassphraseError(msg) || isNoAuthError(msg) || isMissingUsernameError(msg);
}

const liveStore: BackoffStore = {
  status: (id) => useSessionStore.getState().sessions.find((s) => s.id === id)?.status,
  exists: (id) => useSessionStore.getState().sessions.some((s) => s.id === id),
  markReconnecting: (id) => useSessionStore.getState().markConnecting(id),
  markConnected: (id) => useSessionStore.getState().markConnected(id),
  markError: (id, msg) => useSessionStore.getState().markError(id, msg),
  attempt: (id) => useSessionStore.getState().reconnectAttempt(id),
  needsInteractiveInput,
};

export function reconnectWithBackoff(sessionId: string): Promise<boolean> {
  return runBackoff(sessionId, liveStore);
}
