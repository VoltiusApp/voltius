import type { MarketplacePlugin } from "@/stores/marketplaceStore";
import type { SeededEntry } from "@/stores/seededTombstoneStore";
import { satisfiesMinAppVersion } from "@/plugins/version";

/**
 * Synthesises a Browse-tab entry from a seeded (app-bundled) manifest — the local
 * floor for a tombstoned built-in the real catalogue can't currently serve. No
 * `minAppVersion`: these bytes ship in the running app itself, so they're always
 * compatible with it. `builtin: true` marks the row so Browse can badge it and
 * `installPlugin` can route it through the no-network, no-hash-check floor path.
 */
export function floorPluginFrom(entry: SeededEntry): MarketplacePlugin {
  const { manifest } = entry;
  return {
    id: manifest.id,
    name: manifest.name,
    author: "Voltius",
    description: manifest.description ?? "",
    repo: "",
    version: manifest.version,
    tags: [],
    theme: false,
    sourceId: "builtin",
    builtin: true,
  };
}

/**
 * Ids of seeded (app-bundled) built-ins that are currently active — i.e. NOT
 * tombstoned. These are already installed, so Browse must never offer them for
 * install again, even once the real catalogue lists them (a built-in with no
 * tombstone keeps its plain catalogue row — see `mergeBrowseCatalog` — and this is
 * what tells the "Install" button not to render for that row).
 */
export function seededActiveIds(seededEntries: Map<string, SeededEntry>, removedIds: string[]): Set<string> {
  const removed = new Set(removedIds);
  return new Set([...seededEntries.keys()].filter((id) => !removed.has(id)));
}

/**
 * Builds the Browse-tab list: the fetched catalogue plus, for each tombstoned
 * built-in the catalogue can't currently serve — no entry for its id, or one whose
 * `minAppVersion` this app doesn't satisfy — a local floor entry synthesised from
 * its seeded manifest. The catalogue entry wins whenever it is present and
 * version-satisfied, so at most one row is ever shown per id. A built-in that is
 * NOT tombstoned (still active) keeps its plain catalogue row and never gets a
 * floor entry — it's already installed, so `installedIds` in the caller is what
 * keeps it from being offered for install again.
 */
export function mergeBrowseCatalog(
  catalog: MarketplacePlugin[],
  seededEntries: Map<string, SeededEntry>,
  removedIds: string[],
  appVersion: string | null,
): MarketplacePlugin[] {
  const removed = new Set(removedIds);
  const result: MarketplacePlugin[] = [];
  const handled = new Set<string>();

  for (const p of catalog) {
    // Two enabled sources can both list the same tombstoned built-in id — without
    // this guard, a second unsatisfied entry would push a second floor row for the
    // same id, producing a duplicate React key in Browse.
    if (handled.has(p.id)) continue;
    const seeded = seededEntries.get(p.id);
    if (seeded && removed.has(p.id)) {
      const usable = appVersion === null || satisfiesMinAppVersion(p, appVersion);
      result.push(usable ? p : floorPluginFrom(seeded));
      handled.add(p.id);
    } else {
      result.push(p);
    }
  }

  for (const [id, entry] of seededEntries) {
    if (!removed.has(id) || handled.has(id)) continue;
    result.push(floorPluginFrom(entry));
  }

  return result;
}
