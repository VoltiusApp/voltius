import type { Connection } from "@/types";
import { matchesSearch } from "@/utils/connectionFilter";

export const RECENT_HOSTS_CAP = 5;

export const byLastUsed = (a: Connection, b: Connection): number =>
  (b.last_used_at ?? "").localeCompare(a.last_used_at ?? "");

export function recentlyUsed(connections: Connection[], cap?: number): Connection[] {
  const used = connections.filter((c) => c.last_used_at).sort(byLastUsed);
  return cap === undefined ? used : used.slice(0, cap);
}

export function pinnedThenRecent(
  connections: Connection[],
  isPinned: (c: Connection) => boolean,
  usedOnly = false,
): Connection[] {
  const rest = connections.filter((c) => !isPinned(c) && (!usedOnly || c.last_used_at)).sort(byLastUsed);
  return [...connections.filter((c) => isPinned(c)), ...rest];
}

/** Empty query: the most recent hosts, then the rest. A query: no recents, just the matches. */
export function partitionRecentHosts(
  connections: Connection[],
  query: string,
  cap = RECENT_HOSTS_CAP,
): { recent: Connection[]; hosts: Connection[] } {
  if (query.trim()) return { recent: [], hosts: connections.filter((c) => matchesSearch(c, query)) };
  const recent = recentlyUsed(connections, cap);
  const recentIds = new Set(recent.map((c) => c.id));
  return { recent, hosts: connections.filter((c) => !recentIds.has(c.id)) };
}
