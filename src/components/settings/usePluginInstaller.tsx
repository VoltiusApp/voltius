import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMarketplaceStore, type MarketplacePlugin } from "@/stores/marketplaceStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { pluginInstallErrorMessage } from "@/plugins/installErrors";
import { addedPermissions } from "@/plugins/updates";
import { requiresInstallConsent } from "@/plugins/gatedPermissions";
import { getToggle } from "@/stores/toggleSettingsStore";
import { PluginPermissionModal } from "@/components/settings/sections/PluginPermissionModal";

interface PendingReview {
  mode: "install" | "update";
  plugin: MarketplacePlugin;
  permissions: string[];
  addedPermissions: string[];
  /** The exact reviewed manifest text, passed to installPlugin so the loaded perms == consented. */
  manifestText: string;
}

// Gated permissions always force the consent dialog; installPlugin is passed the
// exact reviewed manifest text so the loaded permissions match what was consented.
export function usePluginInstaller() {
  const { t } = useTranslation();
  const installing = useMarketplaceStore((s) => s.installing);
  const installPlugin = useMarketplaceStore((s) => s.installPlugin);
  const fetchManifest = useMarketplaceStore((s) => s.fetchManifest);
  const [preparing, setPreparing] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingReview | null>(null);

  const busy = new Set<string>([...installing, ...preparing]);

  const notifyError = (e: unknown) => {
    const { key, params } = pluginInstallErrorMessage(e, "settings.plugins.install.failed");
    useNotificationStore.getState().addToast({
      source: { kind: "plugin", id: "system", name: "Voltius" },
      type: "toast",
      severity: "error",
      message: t(key, params),
      duration: 0,
    });
  };

  const runInstall = async (plugin: MarketplacePlugin, reviewedManifestText?: string) => {
    try { await installPlugin(plugin, reviewedManifestText); } catch (e) { notifyError(e); }
  };

  const withPreparing = async (id: string, fn: () => Promise<void>) => {
    setPreparing((s) => new Set([...s, id]));
    try { await fn(); } finally {
      setPreparing((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const startInstall = (plugin: MarketplacePlugin) => {
    void withPreparing(plugin.id, async () => {
      try {
        const { manifest, manifestText } = await fetchManifest(plugin);
        const perms = manifest.permissions ?? [];
        // Gated perms always prompt; the review toggle governs only benign installs.
        if (!requiresInstallConsent(perms, getToggle("plugin-install-review"))) {
          await runInstall(plugin, manifestText);
          return;
        }
        setPending({ mode: "install", plugin, permissions: perms, addedPermissions: [], manifestText });
      } catch (e) { notifyError(e); }
    });
  };

  const startUpdate = (plugin: MarketplacePlugin, currentPermissions: string[]) => {
    void withPreparing(plugin.id, async () => {
      try {
        const { manifest, manifestText } = await fetchManifest(plugin);
        const next = manifest.permissions ?? [];
        const added = addedPermissions(currentPermissions, next);
        if (added.length === 0) { await runInstall(plugin, manifestText); return; }
        setPending({ mode: "update", plugin, permissions: next, addedPermissions: added, manifestText });
      } catch (e) { notifyError(e); }
    });
  };

  const confirm = () => {
    if (!pending) return;
    const { plugin, manifestText } = pending;
    setPending(null);
    void runInstall(plugin, manifestText);
  };
  const cancel = () => setPending(null);

  const modal = pending ? (
    <PluginPermissionModal
      mode={pending.mode}
      pluginName={pending.plugin.name}
      permissions={pending.permissions}
      addedPermissions={pending.addedPermissions}
      onConfirm={confirm}
      onCancel={cancel}
    />
  ) : null;

  return { busy, startInstall, startUpdate, modal };
}
