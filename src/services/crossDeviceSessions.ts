import { resolveRemoteSessions, type RemoteSession } from "@/stores/liveSessionManifestCore";
import { useCrossDeviceSessionsStore } from "@/stores/crossDeviceSessionsStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useUIStore } from "@/stores/uiStore";
import { getToggle } from "@/stores/toggleSettingsStore";
import { publishLiveSessionsNow } from "@/services/liveSessionPublisher";
import type { TerminalSession } from "@/types";

function connectionExists(connectionId: string): boolean {
  const { connections, teamConnections } = useConnectionStore.getState();
  return (
    connections.some((c) => c.id === connectionId) ||
    Object.values(teamConnections).flat().some((c) => c.id === connectionId)
  );
}

function remote() {
  const { manifests, tombstones } = useCrossDeviceSessionsStore.getState();
  return resolveRemoteSessions({
    manifests: Object.values(manifests),
    myDeviceId: localStorage.getItem("voltius.device_id") ?? "",
    myTombstones: tombstones,
    myOpenSessionIds: useSessionStore.getState().sessions.map((s) => s.id),
  });
}

/** Live sessions on other devices this one could co-attach right now. */
export function getJoinableSessions(): RemoteSession[] {
  if (!getToggle("cross-device-sessions")) return [];
  return remote().joinable.filter((j) => connectionExists(j.connectionId));
}

/** Co-attach a session another device has open: both stay live, both can type
 * (the multiplexer mirrors all attached clients). Attach-only — if the session
 * died meanwhile, reconnect()'s SESSION_ENDED path tears down and tombstones,
 * which also clears the stale card on every device. */
export async function joinRemoteSession(j: RemoteSession): Promise<void> {
  const session: TerminalSession = {
    id: j.sessionId,
    connectionId: j.connectionId,
    connectionName: j.connectionName,
    status: "connecting",
    persist: true,
    everConnected: true,
    type: "ssh",
  };
  useSessionStore.setState((s) => ({
    sessions: [...s.sessions, session],
    activeSessionId: j.sessionId,
  }));
  useUIStore.getState().setActiveNav("terminal");
  useUIStore.getState().setSidebarOpen(false);

  await useSessionStore.getState().reconnect(j.sessionId, { restore: true });
}

/** The host says this session no longer exists (attach probe failed): drop the
 * tab and tombstone it so other devices' tabs and cards die too. */
export function sessionEnded(sessionId: string): void {
  useSessionStore.getState().removeSession(sessionId);
  useCrossDeviceSessionsStore.getState().markClosed(sessionId);
  publishLiveSessionsNow();
}

/** Tear down tabs whose session another device confirmed killed. The killer
 * already published the tombstone, so plain removal — no re-publish. The
 * connected guard keeps a live tab safe; if its multiplexer really died, its
 * own channel close + attach probe end it anyway. */
export function runClosedCheck(): void {
  if (!getToggle("cross-device-sessions")) return;
  const { closedIds } = remote();
  if (closedIds.length === 0) return;
  const { sessions } = useSessionStore.getState();
  for (const id of closedIds) {
    const session = sessions.find((s) => s.id === id);
    if (session && session.status !== "connected") {
      useSessionStore.getState().removeSession(id);
    }
  }
}

let started = false;

export function startCrossDeviceSessions(): void {
  if (started) return;
  started = true;
  useCrossDeviceSessionsStore.subscribe((s, prev) => {
    if (s.manifests !== prev.manifests) runClosedCheck();
  });
  runClosedCheck();
}
