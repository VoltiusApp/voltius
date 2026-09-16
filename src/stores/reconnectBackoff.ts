import { listen } from "@tauri-apps/api/event";
import { connectionForSession, useSessionStore } from "./sessionStore";
import { serialAutoReconnectEnabled } from "./serialAutoReconnect";
import {
  CATCH_UP_DELAYS_MS,
  type BackoffStore,
  handleSessionClosed,
  runBackoff,
  sleepingBackoffs,
  strandedByNetwork,
  wakeBackoff,
} from "./reconnectBackoffCore";

const liveStore = (restore: boolean): BackoffStore => ({
  status: (id) => useSessionStore.getState().sessions.find((s) => s.id === id)?.status,
  exists: (id) => useSessionStore.getState().sessions.some((s) => s.id === id),
  markReconnecting: (id) => useSessionStore.getState().markConnecting(id),
  markConnected: (id) => useSessionStore.getState().markConnected(id),
  markError: (id, msg, code) => useSessionStore.getState().markError(id, msg, code),
  setWait: (id, wait) => useSessionStore.getState().setReconnectWait(id, wait),
  online: (id) =>
    navigator.onLine !== false || useSessionStore.getState().sessions.find((s) => s.id === id)?.type !== "ssh",
  attempt: (id) => useSessionStore.getState().reconnectAttempt(id, { restore }),
  sessionEnded: (id) => {
    void import("@/services/crossDeviceSessions").then(({ sessionEnded }) => sessionEnded(id));
  },
});

/** `restore` replays the multiplexer history into a tab whose buffer is still empty. */
export function reconnectWithBackoff(
  sessionId: string,
  { restore = false, catchUp }: { restore?: boolean; catchUp?: readonly number[] } = {},
): Promise<boolean> {
  // The drop may be another device closing a shared session — pull manifests
  // now so the tombstone can tear this tab down instead of the loop retrying.
  const s = useSessionStore.getState().sessions.find((x) => x.id === sessionId);
  if (s?.type === "ssh" && s.persist) {
    void import("@/services/sync").then(({ syncNow }) => syncNow().catch(() => {}));
  }
  return runBackoff(sessionId, liveStore(restore), catchUp);
}

/** A host that never connected may be a typo, so it only gets a short catch-up, never the endless loop. */
export function resumeIfStranded(sessionId: string, { restore = false } = {}): void {
  const s = useSessionStore.getState().sessions.find((x) => x.id === sessionId);
  if (!s || !strandedByNetwork(s)) return;
  void reconnectWithBackoff(sessionId, { restore, catchUp: s.everConnected ? undefined : CATCH_UP_DELAYS_MS });
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
  for (const s of useSessionStore.getState().sessions) resumeIfStranded(s.id);
}

/** The OS reports a new routable address, which webviews do not reliably turn into `online`. */
export function startNetworkWatch(): () => void {
  const unlisten = listen("network-changed", onNetworkBack);
  return () => void unlisten.then((fn) => fn());
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
