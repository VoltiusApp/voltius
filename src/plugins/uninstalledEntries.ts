import type { MarketplacePlugin } from "@/stores/marketplaceStore";

/** Catalogue entries not in `taken`, first source wins when several list the same id. */
export function uninstalledEntries(catalog: MarketplacePlugin[], taken: ReadonlySet<string>): MarketplacePlugin[] {
  const seen = new Set<string>();
  return catalog.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return !taken.has(p.id);
  });
}
