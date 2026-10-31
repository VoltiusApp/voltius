import type { MarketplacePlugin } from "@/stores/marketplaceStore";
import { uninstalledEntries } from "@/plugins/uninstalledEntries";
import { satisfiesMinAppVersion } from "@/plugins/version";
import { searchMatcher } from "@/utils/search";

export const MIXED_RESULTS_PLUGIN_LIMIT = 3;
const MIXED_RESULTS_MIN_QUERY = 2;

/** Mixed results skip descriptions so one shared word cannot pull in unrelated plugins. */
export function suggestPlugins(
  catalog: MarketplacePlugin[],
  taken: ReadonlySet<string>,
  appVersion: string | null,
  query: string,
  browsing: boolean,
): MarketplacePlugin[] {
  if (!browsing && query.trim().length < MIXED_RESULTS_MIN_QUERY) return [];
  const match = searchMatcher(query);
  const hits = uninstalledEntries(catalog, taken).filter((p) =>
    (appVersion === null || satisfiesMinAppVersion(p, appVersion)) &&
    (browsing ? match(p.name, p.description, ...p.tags) : match(p.name, p.id, ...p.tags)),
  );
  return browsing ? hits : hits.slice(0, MIXED_RESULTS_PLUGIN_LIMIT);
}
