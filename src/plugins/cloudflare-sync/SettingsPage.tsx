import React from "react";
import type { PluginAPI } from "@/plugins/api";

/** Placeholder settings page; full configure/sync UI lands in a later phase. */
export function createSettingsPage(api: PluginAPI) {
  return function CloudflareSyncSettingsPage() {
    return (
      <div className="p-4 space-y-2">
        <h2 className="text-lg font-semibold">{api.i18n.t("settingsLabel")}</h2>
        <p className="text-sm opacity-70">
          Configure your Worker URL, sync token, and encryption passphrase. Full UI coming next.
        </p>
      </div>
    );
  };
}
