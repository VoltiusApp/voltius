import type { Connection, TerminalSession } from "@/types";

export interface PingTarget {
  key: string;
  host: string;
  port: number;
  connectionIds: string[];
  sessionId: string | null;
  connection: Connection;
}

export function buildPingTargets(
  connections: Connection[],
  sessions: TerminalSession[],
): PingTarget[] {
  const liveByConnectionId = new Map<string, string>();
  for (const s of sessions) {
    if (s.type !== "ssh" || s.status !== "connected") continue;
    if (!liveByConnectionId.has(s.connectionId)) liveByConnectionId.set(s.connectionId, s.id);
  }

  const byKey = new Map<string, PingTarget>();
  for (const c of connections) {
    if (c.ping_disabled || !c.host || !c.port) continue;
    const key = `${c.host}:${c.port}`;
    let target = byKey.get(key);
    if (!target) {
      target = { key, host: c.host, port: c.port, connectionIds: [], sessionId: null, connection: c };
      byKey.set(key, target);
    }
    target.connectionIds.push(c.id);

    const sessionId = liveByConnectionId.get(c.id);
    if (sessionId && !target.sessionId) {
      target.sessionId = sessionId;
      // Probe through the connection that actually owns the session.
      target.connection = c;
    }
  }

  return [...byKey.values()];
}
