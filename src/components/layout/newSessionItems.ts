import type { Connection } from "@/types";

/**
 * Hosts with a last_used_at, newest first. Currently-active connections are
 * excluded unless `includeActive` is set (e.g. to allow opening a second
 * terminal on a host you're already connected to).
 */
export function selectRecentHosts(
  connections: Connection[],
  activeConnectionIds: Set<string>,
  cap?: number,
  includeActive = false,
): Connection[] {
  const recent = [...connections]
    .filter((c) => c.last_used_at && (includeActive || !activeConnectionIds.has(c.id)))
    .sort((a, b) => (b.last_used_at ?? "").localeCompare(a.last_used_at ?? ""));
  return cap === undefined ? recent : recent.slice(0, cap);
}

export interface LauncherHosts {
  recent: Connection[];
  hosts: Connection[];
}

/**
 * Empty query  → { recent: top-N by last_used, hosts: everything not in recent }.
 * Non-empty    → { recent: [], hosts: connections matching name/host/username }.
 */
export function partitionLauncherHosts(
  connections: Connection[],
  activeConnectionIds: Set<string>,
  query: string,
  recentCap = 5,
  includeActive = false,
): LauncherHosts {
  const q = query.trim().toLowerCase();
  if (q) {
    const hosts = connections.filter(
      (c) =>
        (c.name ?? "").toLowerCase().includes(q) ||
        c.host.toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q),
    );
    return { recent: [], hosts };
  }
  const recent = selectRecentHosts(connections, activeConnectionIds, recentCap, includeActive);
  const recentIds = new Set(recent.map((c) => c.id));
  const hosts = connections.filter((c) => !recentIds.has(c.id));
  return { recent, hosts };
}
