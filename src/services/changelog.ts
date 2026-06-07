const CHANGELOG_URL =
  "https://raw.githubusercontent.com/VoltiusApp/voltius/main/CHANGELOG.md";
const CACHE_KEY = "voltius-changelog-cache";

export interface ChangelogGroup {
  label: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  groups: ChangelogGroup[];
}

interface Cache {
  fetchedAt: number;
  raw: string;
}

let memo: string | null = null;

function readCache(): string | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as Cache).raw ?? null;
  } catch {
    return null;
  }
}

function writeCache(raw: string) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), raw } satisfies Cache));
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

/** Fetch the raw CHANGELOG.md, caching the result. Falls back to cache when offline. */
export async function fetchChangelog(): Promise<string | null> {
  if (memo) return memo;
  try {
    const res = await fetch(CHANGELOG_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    memo = raw;
    writeCache(raw);
    return raw;
  } catch {
    return readCache();
  }
}

const ENTRY_RE = /^##\s+\[(?<version>[^\]]+)\]\s*-\s*(?<date>.+)$/;
const GROUP_RE = /^###\s+(?<label>.+)$/;
const BULLET_RE = /^[-*]\s+(?<text>.+)$/;
const LINK_RE = /\[([^\]]+)\]\([^)]+\)/g;

/** Parse Keep-a-Changelog markdown into structured entries, skipping [Unreleased]. */
export function parseChangelog(raw: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let group: ChangelogGroup | null = null;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trimEnd();

    const entryMatch = line.match(ENTRY_RE);
    if (entryMatch?.groups) {
      const version = entryMatch.groups.version.trim();
      group = null;
      if (/unreleased/i.test(version)) {
        entry = null;
        continue;
      }
      entry = { version, date: entryMatch.groups.date.trim(), groups: [] };
      entries.push(entry);
      continue;
    }

    if (!entry) continue;

    const groupMatch = line.match(GROUP_RE);
    if (groupMatch?.groups) {
      group = { label: groupMatch.groups.label.trim(), items: [] };
      entry.groups.push(group);
      continue;
    }

    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch?.groups && group) {
      group.items.push(bulletMatch.groups.text.replace(LINK_RE, "$1").trim());
    }
  }

  return entries;
}

type Semver = [number, number, number];

export function parseSemver(v: string): Semver {
  const [core] = v.replace(/^v/, "").split(/[-+]/);
  const [maj, min, patch] = core.split(".").map((n) => parseInt(n, 10) || 0);
  return [maj, min, patch];
}

/** -1 | 0 | 1 comparing a to b. */
export function cmpSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** A "feature version" bucket: pre-1.0 the minor counts, otherwise the major. */
export function featureVersion(v: string): string {
  const [maj, min] = parseSemver(v);
  return maj === 0 ? `0.${min}` : `${maj}`;
}

/** True when a belongs to a newer feature bucket than b. */
export function isNewerFeature(a: string, b: string): boolean {
  const [aMaj, aMin] = parseSemver(a);
  const [bMaj, bMin] = parseSemver(b);
  return aMaj !== bMaj ? aMaj > bMaj : aMin > bMin;
}
