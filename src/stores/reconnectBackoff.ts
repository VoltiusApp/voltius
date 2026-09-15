import { connectionForSession, useSessionStore } from "./sessionStore";
import { serialAutoReconnectEnabled } from "./serialAutoReconnect";
import {
  type BackoffStore,
  handleSessionClosed,
  runBackoff,
  sleepingBackoffs,
  strandedByNetwork,
  wakeBackoff,
} from "./reconnectBackoffCore";

const liveStore: BackoffStore = {
  status: (id) => useSessionStore.getState().sessions.find((s) => s.id === id)?.status,
  exists: (id) => useSessionStore.getState().sessions.some((s) => s.id === id),
  markReconnecting: (id) => useSessionStore.getState().markConnecting(id),
  markConnected: (id) => useSessionStore.getState().markConnected(id),
  markError: (id, msg, code) => useSessionStore.getState().markError(id, msg, code),
  setWait: (id, wait) => useSessionStore.getState().setReconnectWait(id, wait),
  online: (id) =>
    navigator.onLine !== false || useSessionStore.getState().sessions.find((s) => s.id === id)?.type !== "ssh",
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

const WAKE_JITTER_MS = 1000;
const WAKE_MIN_GAP_MS = 5000;
let lastWakeAll = 0;

function wakeAllBackoffs(): void {
  const now = Date.now();
  if (now - lastWakeAll < WAKE_MIN_GAP_MS) return;
  lastWakeAll = now;
  // Jittered so a dozen tabs on one host do not all handshake in the same instant.
  for (const id of sleepingBackoffs()) setTimeout(() => wakeBackoff(id), Math.random() * WAKE_JITTER_MS);
}

function onNetworkBack(): void {
  lastWakeAll = 0;
  wakeAllBackoffs();
  for (const s of useSessionStore.getState().sessions) {
    if (strandedByNetwork(s)) void reconnectWithBackoff(s.id);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", onNetworkBack);
  window.addEventListener("focus", wakeAllBackoffs);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wakeAllBackoffs();
  });
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
      autoReconnect: (id) => {
        const sess = useSessionStore.getState().sessions.find((s) => s.id === id);
        return !sess || serialAutoReconnectEnabled(sess, connectionForSession(sess));
      },
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
