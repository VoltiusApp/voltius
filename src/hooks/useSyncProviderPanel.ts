import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSyncMotion } from "@/components/shared/SyncStatusIcon";
import { runManualSync } from "@/services/syncIntent";
import { runSyncProviderAction } from "@/services/syncProviderAction";
import type { SyncProviderAction, SyncProviderView } from "@/services/syncProviders";
import { syncStatusColor, type SyncHeaderStatus } from "@/services/syncStatus";
import { INACTIVE_SYNC_ROWS, syncFailureReason, syncStatusLabel } from "@/services/syncStatusText";

const KEEPS_MENU_OPEN: ReadonlySet<SyncProviderAction["kind"]> = new Set(["pause", "resume"]);

export function runSyncMenuAction(action: SyncProviderAction, closeMenu: () => void): void {
  if (!KEEPS_MENU_OPEN.has(action.kind)) closeMenu();
  runSyncProviderAction(action);
}

export function useSyncNow(provider: SyncProviderView) {
  const [pending, setPending] = useState(false);
  const syncNow = provider.syncNow;
  const busy = pending || provider.state.status === "syncing";
  const run = () => {
    if (busy || !syncNow) return;
    setPending(true);
    runManualSync(syncNow).catch(() => {}).finally(() => setPending(false));
  };
  return { available: syncNow !== null, busy, run };
}

export function useSyncProviderPanel(provider: SyncProviderView) {
  const { t } = useTranslation();
  const { availability, state } = provider;
  const active = availability === "active";
  const motion = useSyncMotion(active ? state.status : "idle");
  const syncNow = useSyncNow(provider);
  const inactive = active || availability === "locked" ? null : INACTIVE_SYNC_ROWS[availability];
  const status = active
    ? {
        label: syncStatusLabel(t, motion.status, state.lastSync),
        color: syncStatusColor(motion.status),
        reason: syncFailureReason(motion.status, state.error),
      }
    : null;
  const header: SyncHeaderStatus | null = status
    ? { label: status.label, color: status.color, spin: motion.status === "syncing" }
    : inactive ? { label: t(inactive.labelKey), color: inactive.tone } : null;
  return { syncNow, inactive, status, header };
}
