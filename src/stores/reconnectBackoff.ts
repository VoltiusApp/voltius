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
  sessionEnded: (id) => {
    void import("@/services/crossDeviceSessions").then(({ sessionEnded }) => sessionEnded(id));
  },
};

export function reconnectWithBackoff(sessionId: string): Promise<boolean> {
  // The drop may be another device closing a shared session — pull manifests
  // now so the tombstone can tear this tab down instead of the loop retrying.
  const s = useSessionStore.getState().sessions.find((x) => x.id === sessionId);
  if (s?.type === "ssh" && s.persist) {
    void import("@/services/sync").then(({ syncNow }) => syncNow().catch(() => {}));
  }
  return runBackoff(sessionId, liveStore);
}
