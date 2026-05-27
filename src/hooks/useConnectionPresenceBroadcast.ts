import { useEffect, useRef } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useConnectionPresenceStore } from "@/stores/connectionPresenceStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { notifyConnectionUsage } from "@/services/connectionPresence";
import { getMyUserId } from "@/services/teamService";

/**
 * Mount once at the app root. Diffs the set of active SSH/serial sessions
 * against the last frame and broadcasts start/stop events for sessions whose
 * underlying connection lives in a team vault (vault_id && vault_id !== "personal").
 *
 * The set of "currently broadcasting" connection_ids is the union across all
 * open sessions for that connection — we only flip on start of the first session
 * and off when the last session for that connection ends.
 */
export function useConnectionPresenceBroadcast() {
  const sessions = useSessionStore((s) => s.sessions);
  const [enabled] = useToggle("team-presence");
  const broadcastedRef = useRef<Set<string>>(new Set());
  const wasEnabledRef = useRef(enabled);

  useEffect(() => {
    // Look up each session's connection_id (only "ssh"/"serial" sessions
    // reference a stored connection; local + multiplayer + serial-ephemeral
    // don't have a synced vault connection).
    const { connections, teamConnections } = useConnectionStore.getState();
    const allConnections = [
      ...connections,
      ...Object.values(teamConnections).flat(),
    ];
    const connById = new Map(allConnections.map((c) => [c.id, c]));

    const wanted = new Set<string>();
    if (enabled) {
      for (const sess of sessions) {
        if (sess.type !== "ssh" && sess.type !== "serial") continue;
        if (sess.status !== "connected" && sess.status !== "connecting") continue;
        const conn = connById.get(sess.connectionId);
        if (!conn) continue;
        const vid = conn.vault_id;
        if (!vid || vid === "personal") continue;
        wanted.add(conn.id);
      }
    }

    const broadcasted = broadcastedRef.current;
    for (const id of wanted) {
      if (!broadcasted.has(id)) {
        broadcasted.add(id);
        notifyConnectionUsage(id, true).catch(() => {});
      }
    }
    for (const id of broadcasted) {
      if (!wanted.has(id)) {
        broadcasted.delete(id);
        notifyConnectionUsage(id, false).catch(() => {});
      }
    }

    wasEnabledRef.current = enabled;
  }, [sessions, enabled]);

  // Prime the cached current-user ID so per-card hooks can self-exclude synchronously.
  useEffect(() => {
    getMyUserId()
      .then((id) => useConnectionPresenceStore.getState().setMyUserId(id))
      .catch(() => {});
  }, []);

  // Best-effort: stop everything if the hook unmounts (e.g. app shutting down).
  useEffect(() => {
    return () => {
      const broadcasted = broadcastedRef.current;
      for (const id of broadcasted) {
        notifyConnectionUsage(id, false).catch(() => {});
      }
      broadcasted.clear();
    };
  }, []);
}
