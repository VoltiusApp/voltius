import { setPluginActive } from "@/plugins/runtime";
import { pluginLock, usePluginRegistryStore } from "@/stores/pluginRegistryStore";

export async function applyPluginEnabled(id: string, enabled: boolean): Promise<boolean> {
  if (pluginLock(id) !== null) return false;
  setPluginActive(id, enabled);
  await usePluginRegistryStore.getState().setEnabled(id, enabled);
  return true;
}
