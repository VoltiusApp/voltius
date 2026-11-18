import { availableCatalogProviders } from "@/services/syncProviders";
import { useInstallablePlugins } from "@/hooks/useInstallablePlugins";
import { useInstallPolicy } from "@/stores/pluginRegistryStore";

export function useAvailableSyncProviders() {
  const { merged, taken, appVersion } = useInstallablePlugins();
  const allowed = useInstallPolicy();
  return { available: availableCatalogProviders(merged, taken).filter((p) => allowed(p.id)), appVersion };
}
