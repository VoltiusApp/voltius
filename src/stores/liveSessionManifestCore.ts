// Cross-device live-session manifest logic. No zustand/tauri/"@/" imports so
// it runs under plain node, matching the workspaceSnapshotCore testing pattern.
//
// Sessions are SHARED, not owned: a device listing a session in its manifest is
// a participant, and any device may co-attach. Session ids are UUIDs and never
// reused, so a tombstone permanently retires an id — no event ordering needed.

export const MANIFEST_VERSION = 2;

export interface ManifestSession {
  /** ORIGINAL session UUID — tmux key voltius_<id> derives from it. */
  id: string;
  connectionId: string;
  connectionName: string;
  cwd?: string;
  /** When the publishing device opened its tab (display only). */
  openedAt: string;
}

export interface ClosedSession {
  id: string;
  closedAt: string;
}

export interface LiveSessionManifest {
  version: number;
  deviceId: string;
  deviceName: string;
  updatedAt: string;
  sessions: ManifestSession[];
  closedSessions: ClosedSession[];
}

export interface SessionOpen {
  openedAt: string;
}

export interface SessionTombstone {
  closedAt: string;
}

/** Structural mirror of SnapshotSession (workspaceSnapshotCore). */
export interface ManifestSessionInput {
  id: string;
  type: string;
  connectionId: string;
  connectionName: string;
  persist: boolean;
  cwd?: string;
}

export function buildManifest(input: {
  snapshotSessions: ManifestSessionInput[];
  opens: Record<string, SessionOpen>;
  tombstones: Record<string, SessionTombstone>;
  deviceId: string;
  deviceName: string;
  now?: Date;
}): LiveSessionManifest {
  const now = (input.now ?? new Date()).toISOString();
  const sessions = input.snapshotSessions
    .filter((s) => s.type === "ssh" && s.persist)
    .map((s): ManifestSession => ({
      id: s.id,
      connectionId: s.connectionId,
      connectionName: s.connectionName,
      ...(s.cwd ? { cwd: s.cwd } : {}),
      openedAt: input.opens[s.id]
        ? new Date(input.opens[s.id].openedAt).toISOString()
        : now,
    }));
  const closedSessions = Object.entries(input.tombstones).map(
    ([id, t]): ClosedSession => ({ id, closedAt: t.closedAt }),
  );
  return {
    version: MANIFEST_VERSION,
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    updatedAt: now,
    sessions,
    closedSessions,
  };
}

function isValidSession(x: unknown): x is ManifestSession {
  if (!x || typeof x !== "object") return false;
  const s = x as ManifestSession;
  return (
    typeof s.id === "string" &&
    typeof s.connectionId === "string" &&
    typeof s.connectionName === "string" &&
    typeof s.openedAt === "string"
  );
}

function isValidClosed(x: unknown): x is ClosedSession {
  if (!x || typeof x !== "object") return false;
  const s = x as ClosedSession;
  return typeof s.id === "string" && typeof s.closedAt === "string";
}

export interface RemoteSession {
  sessionId: string;
  deviceId: string;
  deviceName: string;
  connectionId: string;
  connectionName: string;
  cwd?: string;
  openedAt: string;
}

/** joinable: sessions other devices participate in that this device could
 * co-attach right now (not open locally, not tombstoned anywhere); a session
 * shared by several devices yields one entry, from the freshest manifest.
 * closedIds: locally open sessions whose multiplexer another device killed —
 * their tabs point at nothing and must be torn down. */
export function resolveRemoteSessions(input: {
  manifests: LiveSessionManifest[];
  myDeviceId: string;
  myTombstones: Record<string, SessionTombstone>;
  myOpenSessionIds: string[];
}): { joinable: RemoteSession[]; closedIds: string[] } {
  const dead = new Set(Object.keys(input.myTombstones));
  const remoteDead = new Set<string>();
  for (const m of input.manifests) {
    if (m.deviceId === input.myDeviceId) continue;
    for (const c of m.closedSessions) {
      dead.add(c.id);
      remoteDead.add(c.id);
    }
  }

  const open = new Set(input.myOpenSessionIds);
  const best = new Map<string, { updatedAt: string; entry: RemoteSession }>();
  for (const m of input.manifests) {
    if (m.deviceId === input.myDeviceId) continue;
    for (const s of m.sessions) {
      if (dead.has(s.id) || open.has(s.id)) continue;
      const cur = best.get(s.id);
      if (cur && cur.updatedAt >= m.updatedAt) continue;
      best.set(s.id, {
        updatedAt: m.updatedAt,
        entry: {
          sessionId: s.id,
          deviceId: m.deviceId,
          deviceName: m.deviceName,
          connectionId: s.connectionId,
          connectionName: s.connectionName,
          cwd: s.cwd,
          openedAt: s.openedAt,
        },
      });
    }
  }

  return {
    joinable: [...best.values()].map((b) => b.entry),
    closedIds: input.myOpenSessionIds.filter((id) => remoteDead.has(id)),
  };
}

const PRUNE_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

/** Drop 60-day-old opens/tombstones so the persisted maps can't grow forever. */
export function pruneStale<T extends SessionOpen | SessionTombstone>(
  entries: Record<string, T>,
  now: Date,
): Record<string, T> {
  const cutoff = now.getTime() - PRUNE_AGE_MS;
  const out: Record<string, T> = {};
  for (const [id, e] of Object.entries(entries)) {
    const at = "openedAt" in e ? (e as SessionOpen).openedAt : (e as SessionTombstone).closedAt;
    if (new Date(at).getTime() >= cutoff) out[id] = e;
  }
  return out;
}

/** Validate a raw remote manifest. Null when the whole document must be
 * ignored (unknown version, malformed); drops malformed entries silently. */
export function parseManifest(raw: unknown): LiveSessionManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<LiveSessionManifest>;
  if (m.version !== MANIFEST_VERSION) return null;
  if (typeof m.deviceId !== "string" || m.deviceId.length === 0) return null;
  if (!Array.isArray(m.sessions) || !Array.isArray(m.closedSessions)) return null;
  return {
    version: MANIFEST_VERSION,
    deviceId: m.deviceId,
    deviceName: typeof m.deviceName === "string" && m.deviceName ? m.deviceName : "Unknown device",
    updatedAt: typeof m.updatedAt === "string" ? m.updatedAt : "",
    sessions: m.sessions.filter(isValidSession),
    closedSessions: m.closedSessions.filter(isValidClosed),
  };
}
