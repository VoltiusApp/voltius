import { useEffect, useState } from "react";
import { PluginPermissionModal } from "@/components/settings/sections/PluginPermissionModal";
import type { PluginManifest } from "@/plugins/api";
import { keepOffThisDevice, resolveSyncedCandidate, useSyncedPluginConsentStore } from "@/services/pluginSync";
import { useMarketplaceStore, type MarketplacePlugin } from "@/stores/marketplaceStore";

interface Review {
  id: string;
  candidate: MarketplacePlugin;
  manifest: PluginManifest;
  manifestText: string;
}

export function SyncedPluginConsentHost() {
  const head = useSyncedPluginConsentStore((s) => s.queue[0]);
  const [review, setReview] = useState<Review | null>(null);

  useEffect(() => {
    if (!head) return;
    let cancelled = false;
    void (async () => {
      try {
        const candidate = await resolveSyncedCandidate(head);
        if (!candidate) throw new Error("no install source");
        const { manifest, manifestText } = await useMarketplaceStore.getState().fetchManifest(candidate);
        if (!cancelled) setReview({ id: head, candidate, manifest, manifestText });
      } catch (e) {
        console.warn(`[plugin-sync] Cannot review "${head}":`, e);
        if (!cancelled) useSyncedPluginConsentStore.getState().shift();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [head]);

  if (!review || review.id !== head) return null;

  const finish = async (run: () => Promise<void>) => {
    setReview(null);
    try {
      await run();
    } catch (e) {
      console.warn(`[plugin-sync] Consent action for "${review.id}" failed:`, e);
    }
    useSyncedPluginConsentStore.getState().shift();
  };

  return (
    <PluginPermissionModal
      mode="install"
      pluginName={review.manifest.name}
      permissions={review.manifest.permissions ?? []}
      onConfirm={() =>
        void finish(() =>
          useMarketplaceStore.getState().installPlugin(review.candidate, review.manifestText, { syncDriven: true }),
        )
      }
      onCancel={() => void finish(() => keepOffThisDevice([review.id]))}
    />
  );
}
