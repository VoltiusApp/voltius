import type { TFunction } from "i18next";
import type { SyncProviderAvailability } from "@/plugins/api";
import { formatTime, HOUR_MINUTE } from "@/utils/localeFormat";
import type { SyncStatus } from "./sync";
import { isNearbyOnly, type EffectiveSync } from "./syncProviders";
import { SYNC_PAUSED_ICON } from "./syncStatus";

export function syncStatusLabel(
  t: TFunction,
  status: SyncStatus,
  lastSync: Date | null,
  formatLastSync: (d: Date) => string = (d) => formatTime(d, HOUR_MINUTE),
): string {
  if (status === "syncing") return t("layout.sync.status.syncing");
  if (status === "success") {
    return lastSync
      ? t("layout.sync.status.syncedAt", { time: formatLastSync(lastSync) })
      : t("layout.sync.status.synced");
  }
  if (status === "error") return t("layout.sync.status.error");
  if (status === "offline") return t("layout.sync.status.offline");
  return t("layout.sync.status.idle");
}

export function syncFailureReason(status: SyncStatus, error: string | null): string | null {
  return (status === "error" || status === "offline") && error ? error : null;
}

export function effectiveSyncLabel(t: TFunction, sync: EffectiveSync): string {
  if (isNearbyOnly(sync)) return t("layout.sync.local.tooltip");
  if (sync.configured) return syncStatusLabel(t, sync.status, sync.lastSync);
  return t(sync.paused ? "layout.sync.paused" : "mobile.account.off");
}

/** One-line summary for a control with no room for a reason line; `status` is what the icon shows. */
export function syncStatusTooltip(t: TFunction, sync: EffectiveSync, status: SyncStatus): string {
  if (isNearbyOnly(sync)) return t("layout.sync.local.tooltip");
  if (!sync.configured) return t(sync.paused ? "layout.sync.status.paused" : "layout.sync.status.notConfigured");
  if (status === "error") {
    const error = sync.error ?? t("layout.sync.status.unknown");
    return sync.errorSource
      ? t("layout.sync.status.errorDetailFrom", { source: sync.errorSource, error })
      : t("layout.sync.status.errorDetail", { error });
  }
  if (status === "offline" && sync.error) return t("layout.sync.status.offlineDetail", { error: sync.error });
  if (status === "idle") return t("layout.sync.status.default");
  return syncStatusLabel(t, status, sync.lastSync, formatTime);
}

export const INACTIVE_SYNC_ROWS = {
  needs_upgrade: { icon: null, labelKey: "layout.sync.requiresPro", actionKey: "layout.sync.upgradeArrow", tone: "var(--t-text-dim)" },
  disabled: { icon: "lucide:puzzle", labelKey: "layout.sync.pluginDisabled", actionKey: "layout.sync.enableArrow", tone: "var(--t-text-dim)" },
  not_configured: { icon: "lucide:triangle-alert", labelKey: "layout.sync.notConfigured", actionKey: "layout.sync.configureArrow", tone: "var(--t-status-error)" },
  paused: { icon: SYNC_PAUSED_ICON, labelKey: "layout.sync.paused", actionKey: "layout.sync.resumeArrow", tone: "var(--t-text-dim)" },
} as const satisfies Partial<Record<SyncProviderAvailability, unknown>>;
