import { useSessionStore } from "./sessionStore";
import { type BackoffStore, runBackoff } from "./reconnectBackoffCore";

const liveStore: BackoffStore = {
  status: (id) => useSessionStore.getState().sessions.find((s) => s.id === id)?.status,
  exists: (id) => useSessionStore.getState().sessions.some((s) => s.id === id),
  markReconnecting: (id) => useSessionStore.getState().markConnecting(id),
  markConnected: (id) => useSessionStore.getState().markConnected(id),
  markError: (id, msg) => useSessionStore.getState().markError(id, msg),
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
