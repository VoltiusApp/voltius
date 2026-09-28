import type { Connection } from "@/types";
import { matchesSearch } from "@/utils/connectionFilter";
import { normalizeForSearch, searchMatcher } from "@/utils/search";

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
  if (query.trim()) {
    return { recent: [], hosts: connections.filter((c) => matchesSearch(c, query)) };
  }
  const recent = selectRecentHosts(connections, activeConnectionIds, recentCap, includeActive);
  const recentIds = new Set(recent.map((c) => c.id));
  const hosts = connections.filter((c) => !recentIds.has(c.id));
  return { recent, hosts };
}

export interface ShellOption {
  name: string;
  path: string;
}

export type LocalShellItem = { shell: ShellOption | null };

/** "zsh" → "Zsh"; leave multi-word names ("PowerShell 7+") untouched. */
export function shellLabel(name: string): string {
  return /\s/.test(name) ? name : name.charAt(0).toUpperCase() + name.slice(1);
}

/** Icon for a shell, keyed loosely off its name. */
export function shellIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("powershell")) return "lucide:terminal";
  if (n.includes("cmd") || n.includes("command")) return "lucide:square-chevron-right";
  return "lucide:square-terminal";
}

/** A ≥2-char prefix of the keywords "local"/"shell" (needle already folded). */
function matchesLocalKeyword(needle: string): boolean {
  return needle.length >= 2 && ("local".startsWith(needle) || "shell".startsWith(needle));
}

/**
 * True when the query matches a shell's name/path, or is a ≥2-char prefix of
 * the keywords "local"/"shell". Empty query always matches.
 */
export function localShellMatches(shell: ShellOption, q: string): boolean {
  const needle = normalizeForSearch(q.trim());
  if (!needle) return true;
  if (searchMatcher(needle)(shell.name, shell.path)) return true;
  return matchesLocalKeyword(needle);
}

/**
 * OmniSearch surfacing: empty query → a single default entry ({ shell: null });
 * non-empty query → one entry per matching shell.
 */
export function selectLocalShellItems(shells: ShellOption[], q: string): LocalShellItem[] {
  const needle = normalizeForSearch(q.trim());
  if (!needle) return [{ shell: null }];
  const matched = shells.filter((s) => localShellMatches(s, needle));
  // Keyword matched but no specific shells detected → fall back to the default entry
  // so the Local section still offers a launchable option.
  if (matched.length === 0 && matchesLocalKeyword(needle)) {
    return [{ shell: null }];
  }
  return matched.map((s) => ({ shell: s }));
}

/** Display labels that appear on more than one shell → need a path subtitle to disambiguate. */
export function localShellNeedsPath(shells: ShellOption[]): Set<string> {
  const counts = new Map<string, number>();
  for (const s of shells) {
    const label = shellLabel(s.name);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, c]) => c > 1).map(([label]) => label));
}
