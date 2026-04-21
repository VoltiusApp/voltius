import { useEffect } from "react";
import { onSshOutput } from "@/services/ssh";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { appendSshOutputBuffer, drainSshOutputBuffer } from "@/services/multiplayerService";

/**
 * Subscribes to SSH output events for a session.
 * - Always buffers output so it can be used as a snapshot when sharing starts.
 * - Forwards live output to the multiplayer WebSocket while actively sharing as host.
 */
export function useMultiplayerHostBroadcast(localSessionId: string) {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    onSshOutput(localSessionId, (data) => {
      const conn = useTeamSessionStore.getState().connections[localSessionId];
      if (conn?.role === "host") {
        // Sharing is active — forward live output to the relay.
        conn.connection.sendOutput(data).catch(() => {});
      } else {
        // Not sharing yet — buffer for use as initial snapshot when sharing starts.
        appendSshOutputBuffer(localSessionId, data);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
      // Drop the buffer if the terminal closes without ever sharing.
      drainSshOutputBuffer(localSessionId);
    };
  }, [localSessionId]);
}
