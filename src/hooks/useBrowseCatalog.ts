import { useEffect, useState } from "react";
import { mergeBrowseCatalog, seededActiveIds } from "@/plugins/floor";
import { useMarketplaceStore } from "@/stores/marketplaceStore";
import { loadSeededEntries, useSeededTombstoneStore, type SeededEntry } from "@/stores/seededTombstoneStore";

export function useBrowseCatalog() {
  const { catalog, catalogLoading, fetchCatalog, installedMeta, appVersion, loadAppVersion } = useMarketplaceStore();
  const removedIds = useSeededTombstoneStore((s) => s.removed);
  const [seededEntries, setSeededEntries] = useState<Map<string, SeededEntry>>(new Map());

  useEffect(() => {
    if (catalog.length === 0 && !catalogLoading) void fetchCatalog();
    if (appVersion === null) void loadAppVersion();
    void loadSeededEntries().then(setSeededEntries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Built-ins still active (not tombstoned) are already installed — Browse must
  // never offer them for install again, even once the catalogue lists them.
  const seededActive = seededActiveIds(seededEntries, removedIds);
  return {
    merged: mergeBrowseCatalog(catalog, seededEntries, removedIds, appVersion),
    installedIds: new Set([...installedMeta.map((m) => m.id), ...seededActive]),
    seededActive,
    seededEntries,
    appVersion,
  };
}
