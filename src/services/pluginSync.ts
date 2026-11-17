import type { PluginManifest } from "@/plugins/api";
import type { MarketplacePlugin } from "@/stores/marketplaceStore";
import { policyInstallList } from "@/stores/pluginRegistryStore";
import { useSyncedPluginStore } from "@/stores/syncedPluginStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";

export function syncEligible(id: string, sourceId: string): boolean {
  return sourceId !== "local" && sourceId !== "url" && !policyInstallList().includes(id);
}

async function swallowed(id: string, record: () => Promise<void>): Promise<void> {
  try {
    await record();
  } catch (e) {
    console.warn(`[plugin-sync] Failed to record "${id}":`, e);
  }
}

export async function recordUserInstall(entry: MarketplacePlugin, manifest: PluginManifest): Promise<void> {
  if (!syncEligible(entry.id, entry.sourceId)) return;
  await swallowed(entry.id, async () => {
    await useSyncedPluginStore.getState().recordInstall(entry.id, {
      repo: entry.repo,
      source_id: entry.sourceId,
      hash: entry.hash ?? null,
      css_hash: entry.cssHash ?? null,
      permissions: manifest.permissions ?? [],
      name: manifest.name,
    });
    const prefs = useSyncPrefsStore.getState();
    if (prefs.isExcluded(entry.id)) prefs.toggleExcluded(entry.id);
  });
}

export const recordUserUninstall = (id: string): Promise<void> =>
  swallowed(id, () => useSyncedPluginStore.getState().recordUninstall(id));
