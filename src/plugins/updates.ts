import { FIRST_PARTY_SOURCE, type InstalledPluginMeta, type MarketplacePlugin } from "@/stores/marketplaceStore";
import type { PluginManifest } from "@/plugins/api";
import { beatsSeededVersion, satisfiesMinAppVersion } from "@/plugins/version";

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
 * installed and catalog hashes are present and differ — for either the bundle hash or the
 * stylesheet hash (catches versionless re-stamps of an in-repo bundle served from a mutable ref).
 * When an installed hash is unknown (unverified/local), that signal is skipped.
 */
export function availableUpdate(
  meta: InstalledPluginMeta,
  catalog: MarketplacePlugin[],
): MarketplacePlugin | null {
  // Require an exact source match: never treat an arbitrary catalog entry that merely shares an id
  // as an update for a plugin installed from a different (or "local"/"url") source — updating from
  // it would overwrite the installed bundle from an unrelated repo.
  const entry = catalog.find((p) => p.id === meta.id && p.sourceId === meta.sourceId);
  if (!entry) return null;

  if (compareSemver(entry.version, meta.version) > 0) return entry;
  if (meta.hash && entry.hash && entry.hash.toLowerCase() !== meta.hash.toLowerCase()) return entry;
  if (meta.cssHash && entry.cssHash && entry.cssHash.toLowerCase() !== meta.cssHash.toLowerCase()) return entry;
  return null;
}

/**
 * The catalogue entry that represents an update for an ACTIVE built-in — a seeded
 * (app-bundled) artifact that is not tombstoned and has no external install — or null.
 *
 * Only the first-party source may offer this: the search is scoped to `sourceId ===
 * FIRST_PARTY_SOURCE.id`, mirroring `availableUpdate`'s exact-sourceId guard so a
 * third-party source listing the same manifest id (e.g. a rogue "plugin-docker") can
 * never push code into a built-in's slot.
 *
 * Compared against `seededManifest`, not any `installedMeta` entry — a seeded plugin
 * never has one, and the seeded manifest is what's actually running. Version
 * precedence uses `beatsSeededVersion`, the same rule `mergeBrowseCatalog` applies when
 * deciding whether a catalogue entry may replace a seeded one — see its doc comment.
 */
export function availableSeededUpdate(
  seededManifest: PluginManifest,
  catalog: MarketplacePlugin[],
  appVersion: string | null,
): MarketplacePlugin | null {
  const entry = catalog.find((p) => p.id === seededManifest.id && p.sourceId === FIRST_PARTY_SOURCE.id);
  if (!entry) return null;
  if (appVersion !== null && !satisfiesMinAppVersion(entry, appVersion)) return null;
  return beatsSeededVersion(entry.version, seededManifest.version) ? entry : null;
}

/** Permissions declared in `next` that are not in `current`. */
export function addedPermissions(current: string[], next: string[]): string[] {
  const have = new Set(current);
  return next.filter((p) => !have.has(p));
}
