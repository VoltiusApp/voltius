import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSessionStore } from "@/stores/sessionStore";
import { getPfState } from "@/services/portForwardingTunnels";
import type { ActiveTunnel } from "@/types";

interface PfStatePayload {
  session_id: string;
  tunnels: ActiveTunnel[];
}

/** Returns the total number of active tunnels across all connected SSH sessions. */
export function useActiveTunnelCount(): number {
  const sessions = useSessionStore((s) => s.sessions);
  const [tunnelMap, setTunnelMap] = useState<Map<string, number>>(new Map());

  const sshSessionIds = sessions
    .filter((s) => s.type === "ssh" && s.status === "connected")
    .map((s) => s.id);
  const sessionIdKey = sshSessionIds.join(",");

  useEffect(() => {
    for (const sessionId of sshSessionIds) {
      getPfState(sessionId)
        .then((state) => {
          setTunnelMap((prev) => new Map(prev).set(sessionId, state.tunnels.length));
        })
        .catch(() => {});
    }
    setTunnelMap((prev) => {
      const next = new Map(prev);
      for (const key of next.keys()) {
        if (!sshSessionIds.includes(key)) next.delete(key);
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdKey]);

  useEffect(() => {
    const ids = sshSessionIds;
    let cleanup: (() => void) | undefined;

    listen<PfStatePayload>("pf-state-changed", ({ payload }) => {
      if (!ids.includes(payload.session_id)) return;
      setTunnelMap((prev) => new Map(prev).set(payload.session_id, payload.tunnels.length));
    }).then((u) => { cleanup = u; });

    return () => { cleanup?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdKey]);

  let total = 0;
  for (const count of tunnelMap.values()) total += count;
  return total;
}
