import { useSessionStore } from "./sessionStore";
import { type BackoffStore, handleSessionClosed, runBackoff } from "./reconnectBackoffCore";

const liveStore: BackoffStore = {
  status: (id) => useSessionStore.getState().sessions.find((s) => s.id === id)?.status,
  exists: (id) => useSessionStore.getState().sessions.some((s) => s.id === id),
  markReconnecting: (id) => useSessionStore.getState().markConnecting(id),
  markConnected: (id) => useSessionStore.getState().markConnected(id),
  markError: (id, msg, code) => useSessionStore.getState().markError(id, msg, code),
  attempt: (id) => useSessionStore.getState().reconnectAttempt(id),
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

/** `handleSessionClosed` bound to the live stores — every terminal view routes
 * its channel-closed event through this. */
export function sessionClosed(sessionType: string, sessionId: string, remoteExit: boolean): void {
  handleSessionClosed(
    sessionType,
    sessionId,
    {
      status: (id) => useSessionStore.getState().sessions.find((s) => s.id === id)?.status,
      persist: (id) => !!useSessionStore.getState().sessions.find((s) => s.id === id)?.persist,
      markDisconnected: (id) => useSessionStore.getState().markDisconnected(id),
      reconnectWithBackoff,
      endSession: (id) => {
        // The shell is already gone; this drops the transport and the tab.
        void import("@/services/closeSession").then(({ closeSession }) => closeSession(id));
      },
    },
    remoteExit,
  );
}
