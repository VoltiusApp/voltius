import { getLoadedPlugins, isPluginActive, setPluginActive } from "@/plugins/runtime";
import { pluginDefaultEnabled } from "@/plugins/pluginDefaultEnabled";
import { useMarketplaceStore } from "@/stores/marketplaceStore";
import { loadSeededEntries } from "@/stores/seededTombstoneStore";
import { lockedList } from "@/stores/policyStore";
import { applyPluginInstallPolicy } from "@/services/cliPlugins";
import { PLUGIN_LIST_KEYS, pluginLock, usePluginRegistryStore } from "@/stores/pluginRegistryStore";

export async function applyPluginEnabled(id: string, enabled: boolean): Promise<boolean> {
  if (pluginLock(id) !== null) return false;
  setPluginActive(id, enabled);
  await usePluginRegistryStore.getState().setEnabled(id, enabled);
  return true;
}

let lockedAtLastApply = new Set<string>();

function syncActiveWithLocks(): void {
  const { installedMeta } = useMarketplaceStore.getState();
  const registry = usePluginRegistryStore.getState();
  const loaded = getLoadedPlugins();
  const lockedNow = new Set(loaded.filter((m) => pluginLock(m.id) !== null).map((m) => m.id));
  for (const m of loaded) {
    if (!lockedNow.has(m.id) && !lockedAtLastApply.has(m.id)) continue;
    const enabled = registry.isEnabled(m.id, pluginDefaultEnabled(m, installedMeta));
    if (enabled !== isPluginActive(m.id)) setPluginActive(m.id, enabled);
  }
  lockedAtLastApply = lockedNow;
}

async function warnUnknownPluginIds(): Promise<void> {
  const { installedMeta, catalog } = useMarketplaceStore.getState();
  const known = new Set([...getLoadedPlugins(), ...installedMeta, ...catalog].map((p) => p.id));
  for (const id of (await loadSeededEntries()).keys()) known.add(id);
  for (const key of PLUGIN_LIST_KEYS) {
    for (const id of lockedList(key) ?? []) {
      if (!known.has(String(id))) console.warn(`[policy] ${key}: unknown plugin id ${String(id)}`);
    }
  }
}

export function applyPluginPolicy(): void {
  syncActiveWithLocks();
  void warnUnknownPluginIds().catch(() => {});
  void applyPluginInstallPolicy();
}
