import { useEffect } from "react";
import { onSessionOutput } from "@/services/sessionInput";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { appendSessionOutputBuffer, drainSessionOutputBuffer } from "@/services/multiplayerService";
import { createUtf8Transcoder } from "@/utils/terminalEncoding";
import type { TerminalSession } from "@/types";

/**
 * Subscribes to a session's output events, whatever its transport.
 * - Always buffers output so it can be used as a snapshot when sharing starts.
 * - Forwards live output to the multiplayer WebSocket while actively sharing as host.
 * The relay carries UTF-8, so a legacy-encoded session is transcoded on the way out.
 */
export function useMultiplayerHostBroadcast(localSessionId: string, sessionType: TerminalSession["type"], encoding?: string) {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    const toUtf8 = createUtf8Transcoder(encoding);

    onSessionOutput(localSessionId, sessionType, (raw) => {
      const data = toUtf8(raw);
      if (!data.length) return;
      const conn = useTeamSessionStore.getState().connections[localSessionId];
      if (conn?.role === "host") {
        // Sharing is active — forward live output to the relay.
        conn.connection.sendOutput(data).catch(() => {});
      } else {
        // Not sharing yet — buffer for use as initial snapshot when sharing starts.
        appendSessionOutputBuffer(localSessionId, data);
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
      drainSessionOutputBuffer(localSessionId);
    };
  }, [localSessionId, sessionType, encoding]);
}
