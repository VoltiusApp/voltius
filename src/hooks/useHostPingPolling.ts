import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useHostPingStore, type PingStatus } from "@/stores/hostPingStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSessionStore } from "@/stores/sessionStore";
import { resolveJumpHosts } from "@/services/credentials";
import type { Connection } from "@/types";

async function pingConnection(c: Connection, onResult: (id: string, status: PingStatus, latencyMs?: number) => void) {
  try {
    let latencyMs: number | null;
    if (c.jump_hosts?.length) {
      const jumpHosts = await resolveJumpHosts(c);
      latencyMs = await invoke<number | null>("ping_host_via_jumps", { host: c.host, port: c.port, jumpHosts });
    } else {
      latencyMs = await invoke<number | null>("ping_host", { host: c.host, port: c.port });
    }
    if (latencyMs !== null && latencyMs !== undefined) {
      onResult(c.id, "up", latencyMs);
    } else {
      onResult(c.id, "down");
    }
  } catch {
    onResult(c.id, "unknown");
  }
}

export function useHostPingPolling() {
  const [enabled] = useToggle("reachability");
  const pollIntervalMs = useHostPingStore((s) => s.pollIntervalMs);
  const activePollIntervalMs = useHostPingStore((s) => s.activePollIntervalMs);
  const priorityConnectionIds = useHostPingStore((s) => s.priorityConnectionIds);
  const personalConnections = useConnectionStore((s) => s.connections);
  const teamConnections = useConnectionStore((s) => s.teamConnections);
  const sessions = useSessionStore((s) => s.sessions);
  const setStatus = useHostPingStore((s) => s.setStatus);
  const clearStatuses = useHostPingStore((s) => s.clearStatuses);

  // Slow poll — all pingable connections
  useEffect(() => {
    if (!enabled) {
      clearStatuses();
      return;
    }

    const connections = [...personalConnections, ...Object.values(teamConnections).flat()];
    const toCheck = connections.filter((c) => !c.ping_disabled);
    if (toCheck.length === 0) return;

    let cancelled = false;
    const pollAll = () => Promise.allSettled(
      toCheck.map((c) => pingConnection(c, (id, status, latencyMs) => {
        if (!cancelled) setStatus(id, status, latencyMs);
      })),
    );

    pollAll();
    const interval = setInterval(pollAll, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, pollIntervalMs, personalConnections, teamConnections, setStatus, clearStatuses]);

  // Fast poll — hovered cards and cards with an active terminal session
  useEffect(() => {
    if (!enabled) return;

    const activeSessionConnectionIds = sessions
      .filter((s) => s.status === "connected" && s.type === "ssh")
      .map((s) => s.connectionId);
    const fastIds = new Set([...priorityConnectionIds, ...activeSessionConnectionIds]);
    if (fastIds.size === 0) return;

    const allConnections = [...personalConnections, ...Object.values(teamConnections).flat()];
    const toCheck = allConnections.filter((c) => fastIds.has(c.id) && !c.ping_disabled);
    if (toCheck.length === 0) return;

    let cancelled = false;
    const pollFast = () => Promise.allSettled(
      toCheck.map((c) => pingConnection(c, (id, status, latencyMs) => {
        if (!cancelled) setStatus(id, status, latencyMs);
      })),
    );

    pollFast();
    const interval = setInterval(pollFast, activePollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, activePollIntervalMs, priorityConnectionIds, sessions, personalConnections, teamConnections, setStatus]);
}
