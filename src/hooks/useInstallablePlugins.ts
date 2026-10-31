import { getLoadedPlugins } from "@/plugins/runtime";
import { useBrowseCatalog } from "@/hooks/useBrowseCatalog";

/** The browse catalogue plus every id already present, installed or loaded. */
export function useInstallablePlugins() {
  const { merged, installedIds, appVersion } = useBrowseCatalog();
  const taken = new Set([...installedIds, ...getLoadedPlugins().map((m) => m.id)]);
  return { merged, taken, appVersion };
}
