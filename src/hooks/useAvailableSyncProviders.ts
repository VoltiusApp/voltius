import { getLoadedPlugins } from "@/plugins/runtime";
import { availableCatalogProviders } from "@/services/syncProviders";
import { useBrowseCatalog } from "@/hooks/useBrowseCatalog";

export function useAvailableSyncProviders() {
  const { merged, installedIds, appVersion } = useBrowseCatalog();
  const taken = new Set([...installedIds, ...getLoadedPlugins().map((m) => m.id)]);
  return { available: availableCatalogProviders(merged, taken), appVersion };
}
