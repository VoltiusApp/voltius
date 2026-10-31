import { availableCatalogProviders } from "@/services/syncProviders";
import { useInstallablePlugins } from "@/hooks/useInstallablePlugins";

export function useAvailableSyncProviders() {
  const { merged, taken, appVersion } = useInstallablePlugins();
  return { available: availableCatalogProviders(merged, taken), appVersion };
}
