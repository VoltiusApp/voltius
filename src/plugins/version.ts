/** Thrown when a plugin's `minAppVersion` is not satisfied by the running app. */
export class MinAppVersionError extends Error {
  constructor(public readonly required: string, public readonly actual: string) {
    super(`Plugin requires app version ${required} or later (running ${actual}).`);
    this.name = "MinAppVersionError";
  }
}

/** Parsed `major.minor.patch[-prerelease]`. */
interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

/** Parses `major.minor.patch`, an optional leading `v`, and an optional `-prerelease`
 *  suffix. Missing segments default to 0. Returns null when the string has no
 *  parseable numeric segment at all. */
function parseVersion(raw: string): ParsedVersion | null {
  const trimmed = raw.trim().replace(/^v/i, "");
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(trimmed);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: match[2] !== undefined ? Number(match[2]) : 0,
    patch: match[3] !== undefined ? Number(match[3]) : 0,
    prerelease: match[4] ?? null,
  };
}

/** Compares two version strings. Returns -1 if `a` < `b`, 1 if `a` > `b`, 0 if equal.
 *  A prerelease sorts below the same major.minor.patch without one (`1.0.0-beta.1` <
 *  `1.0.0`). Unparseable input sorts as `0.0.0`. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a) ?? { major: 0, minor: 0, patch: 0, prerelease: null };
  const pb = parseVersion(b) ?? { major: 0, minor: 0, patch: 0, prerelease: null };

  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }

  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  return pa.prerelease < pb.prerelease ? -1 : pa.prerelease > pb.prerelease ? 1 : 0;
}

/**
 * True when `candidateVersion` should replace `seededVersion` (an app-bundled,
 * inherently-trusted artifact). Newer wins; on a tie, or when either input is
 * missing/non-string/unparseable, the seeded artifact wins — it makes no network
 * call and its bytes sit inside the app's own signature, so any doubt resolves in
 * its favour. This is a stricter check than plugging both into `compareVersions`:
 * that function coerces an unparseable string to `0.0.0`, so a malformed
 * `seededVersion` alone would make almost any parseable `candidateVersion` look
 * "newer" — exactly backwards for a downgrade guard. Both sides are validated
 * before comparing so that can't happen. Same rule used by `mergeBrowseCatalog`
 * (Browse-tab row selection) and the boot-time floor check, so the two can never
 * disagree about which bytes are trusted.
 */
export function beatsSeededVersion(candidateVersion: unknown, seededVersion: unknown): boolean {
  if (typeof candidateVersion !== "string" || typeof seededVersion !== "string") return false;
  if (parseVersion(candidateVersion) === null || parseVersion(seededVersion) === null) return false;
  return compareVersions(candidateVersion, seededVersion) > 0;
}

/**
 * True when `version` is a string `beatsSeededVersion` can actually compare.
 * `beatsSeededVersion` returns `false` both for a real tie and for malformed input,
 * so a caller that reads `false` as "the other side wins" needs this to tell those
 * two cases apart first — checking it before comparing, not after, so a malformed
 * version is never silently treated as a legitimate loss.
 */
export function isParsableVersion(version: unknown): boolean {
  return typeof version === "string" && parseVersion(version) !== null;
}

/** True when `plugin.minAppVersion` is absent, unparseable (fail-open — a malformed
 *  catalogue field must never block an install), or satisfied by `appVersion`. */
export function satisfiesMinAppVersion(plugin: { minAppVersion?: string }, appVersion: string): boolean {
  const { minAppVersion } = plugin;
  if (!minAppVersion) return true;
  if (parseVersion(minAppVersion) === null) {
    console.warn(`[marketplace] Unparseable minAppVersion "${minAppVersion}" — ignoring.`);
    return true;
  }
  return compareVersions(appVersion, minAppVersion) >= 0;
}
