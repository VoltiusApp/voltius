import type { InstalledPluginMeta, MarketplacePlugin } from "@/stores/marketplaceStore";

/**
 * Loose numeric-dotted semver compare (no dependency). Pre-release/build suffixes are ignored,
 * missing segments count as 0. Returns -1 | 0 | 1.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .split(/[-+]/, 1)[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * The catalog entry that represents an update for an installed plugin, or null.
 *
 * An update exists when the catalog `version` is newer, OR the version is unchanged but both the
 * installed and catalog hashes are present and differ (catches versionless re-stamps of an in-repo
 * bundle served from a mutable ref). When the installed hash is unknown (unverified/local), only
 * the version signal is used.
 */
export function availableUpdate(
  meta: InstalledPluginMeta,
  catalog: MarketplacePlugin[],
): MarketplacePlugin | null {
  const candidates = catalog.filter((p) => p.id === meta.id);
  if (candidates.length === 0) return null;
  const entry = candidates.find((p) => p.sourceId === meta.sourceId) ?? candidates[0];

  if (compareSemver(entry.version, meta.version) > 0) return entry;
  if (meta.hash && entry.hash && entry.hash.toLowerCase() !== meta.hash.toLowerCase()) return entry;
  return null;
}

/** Permissions declared in `next` that are not in `current`. */
export function addedPermissions(current: string[], next: string[]): string[] {
  const have = new Set(current);
  return next.filter((p) => !have.has(p));
}
