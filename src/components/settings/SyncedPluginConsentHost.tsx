import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PluginPermissionModal } from "@/components/settings/sections/PluginPermissionModal";
import { notifyInstallError } from "@/components/settings/usePluginInstaller";
import type { PluginManifest } from "@/plugins/api";
import {
  consentStillWanted,
  keepOffThisDevice,
  resolveSyncedCandidate,
  useSyncedPluginConsentStore,
  type ConsentRequest,
} from "@/services/pluginSync";
import { useMarketplaceStore, type MarketplacePlugin } from "@/stores/marketplaceStore";

interface Review {
  request: ConsentRequest;
  candidate: MarketplacePlugin;
  manifest: PluginManifest;
  manifestText: string;
}

const shift = () => useSyncedPluginConsentStore.getState().shift();

export function SyncedPluginConsentHost() {
  const { t } = useTranslation();
  const head = useSyncedPluginConsentStore((s) => s.queue[0]);
  const [review, setReview] = useState<Review | null>(null);

  useEffect(() => {
    if (!head) return;
    if (!consentStillWanted(head)) {
      shift();
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const candidate = await resolveSyncedCandidate(head.id);
        if (!candidate) throw new Error("no install source");
        const { manifest, manifestText } = await useMarketplaceStore.getState().fetchManifest(candidate);
        if (!cancelled) setReview({ request: head, candidate, manifest, manifestText });
      } catch (e) {
        console.warn(`[plugin-sync] Cannot review "${head.id}":`, e);
        if (!cancelled) shift();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [head]);

  if (!review || review.request !== head) return null;

  const finish = (run: () => Promise<void>) => {
    setReview(null);
    void run()
      .catch((e) => console.warn(`[plugin-sync] Consent action for "${review.request.id}" failed:`, e))
      .finally(shift);
  };

  const install = async () => {
    try {
      await useMarketplaceStore.getState().installPlugin(review.candidate, review.manifestText, { syncDriven: true });
    } catch (e) {
      notifyInstallError(e, t);
    }
  };

  const decline = () => (review.request.keep ? Promise.resolve() : keepOffThisDevice([review.request.id]));

  return (
    <PluginPermissionModal
      mode="install"
      pluginName={review.manifest.name}
      permissions={review.manifest.permissions ?? []}
      onConfirm={() => finish(install)}
      onCancel={() => finish(decline)}
    />
  );
}
