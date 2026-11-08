import { useEffect, useRef } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useConnectionPresenceStore } from "@/stores/connectionPresenceStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { notifyConnectionUsage } from "@/services/connectionPresence";
import { sseRetryDelay } from "@/services/syncRetry";
import { getMyUserId } from "@/services/teamService";
import type { TerminalSession } from "@/types";

type Notify = (connectionId: string, inUse: boolean) => Promise<void>;
type Schedule = (fn: () => void, ms: number) => () => void;

const scheduleTimeout: Schedule = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

export interface UsageAnnouncer {
  reconcile: (wanted: Set<string>) => void;
  resync: () => void;
  dispose: () => void;
}

export function createUsageAnnouncer(
  notify: Notify,
  retryDelay: (failures: number) => number = sseRetryDelay,
  schedule: Schedule = scheduleTimeout,
): UsageAnnouncer {
  let wanted = new Set<string>();
  // What the server last acknowledged per connection; null = unknown, absent = not in use.
  const acked = new Map<string, true | null>();
  const inflight = new Map<string, boolean>();
  let failures = 0;
  let cancelRetry: (() => void) | null = null;
  let disposed = false;

  const pump = () => {
    if (disposed) return;
    for (const id of new Set([...wanted, ...acked.keys()])) {
      const inUse = wanted.has(id);
      const state = acked.get(id);
      if (inflight.has(id) || (state !== null && (state === true) === inUse)) continue;
      inflight.set(id, inUse);
      notify(id, inUse).then(
        () => {
          inflight.delete(id);
          failures = 0;
          if (inUse) acked.set(id, true);
          else acked.delete(id);
          pump();
        },
        () => {
          inflight.delete(id);
          acked.set(id, null);
          failures += 1;
          if (!disposed && !cancelRetry) {
            cancelRetry = schedule(() => { cancelRetry = null; pump(); }, retryDelay(failures));
          }
        },
      );
    }
  };

  return {
    reconcile: (next) => { wanted = next; pump(); },
    resync: () => {
      for (const id of acked.keys()) acked.set(id, null);
      cancelRetry?.();
      cancelRetry = null;
      failures = 0;
      pump();
    },
    dispose: () => {
      disposed = true;
      cancelRetry?.();
      const live = [...acked.keys(), ...[...inflight].filter(([, inUse]) => inUse).map(([id]) => id)];
      for (const id of new Set(live)) notify(id, false).catch(() => {});
      acked.clear();
    },
  };
}

function teamConnectionsInUse(sessions: TerminalSession[]): Set<string> {
  const { connections, teamConnections } = useConnectionStore.getState();
  const connById = new Map([...connections, ...Object.values(teamConnections).flat()].map((c) => [c.id, c]));
  const wanted = new Set<string>();
  for (const sess of sessions) {
    if (sess.type !== "ssh" && sess.type !== "serial") continue;
    if (sess.status !== "connected" && sess.status !== "connecting") continue;
    const conn = connById.get(sess.connectionId);
    if (conn?.vault_id && conn.vault_id !== "personal") wanted.add(conn.id);
  }
  return wanted;
}

/** Mount once at the app root: tells teammates which team-vault connections this device has open. */
export function useConnectionPresenceBroadcast() {
  const sessions = useSessionStore((s) => s.sessions);
  const [enabled] = useToggle("team-presence");
  const streamEpoch = useConnectionPresenceStore((s) => s.streamEpoch);
  const announcerRef = useRef<UsageAnnouncer | null>(null);

  useEffect(() => {
    const announcer = createUsageAnnouncer(notifyConnectionUsage);
    announcerRef.current = announcer;
    return () => {
      announcer.dispose();
      announcerRef.current = null;
    };
  }, []);

  useEffect(() => {
    announcerRef.current?.reconcile(enabled ? teamConnectionsInUse(sessions) : new Set());
  }, [sessions, enabled]);

  useEffect(() => {
    announcerRef.current?.resync();
  }, [streamEpoch]);

  useEffect(() => {
    getMyUserId()
      .then((id) => useConnectionPresenceStore.getState().setMyUserId(id))
      .catch(() => {});
  }, []);
}
