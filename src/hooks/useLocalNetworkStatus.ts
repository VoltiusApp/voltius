import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useCanPairDevices } from "@/hooks/useNoAccountInstall";
import { useLanDeviceRows } from "@/hooks/useLanDeviceRows";
import { logFailure } from "@/lib/logger";
import { blockedFix } from "@/services/lanBlockedFix";
import { setLanSyncPaused } from "@/services/lanSync";
import type { DeviceRow } from "@/services/lanSyncDevices";
import type { SyncHeaderStatus } from "@/services/syncStatus";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import { usePlatform } from "@/utils/platform";

function statusLine(t: TFunction, paused: boolean, blocked: boolean, rows: DeviceRow[], platform: string | null): SyncHeaderStatus {
  if (paused) return { color: "var(--t-text-dim)", label: t("layout.sync.local.status.paused") };
  if (blocked) {
    const { color, label } = blockedFix(t, platform);
    return { color, label };
  }
  const syncing = rows.find((r) => r.dot === "syncing");
  if (syncing) return { color: "var(--t-accent)", spin: true, label: t("layout.sync.local.status.syncing", { name: syncing.name }) };
  const live = rows.filter((r) => r.dot === "live").length;
  if (live > 0) return { color: "var(--t-status-connected)", label: t("layout.sync.local.status.live", { count: live }) };
  return { color: "var(--t-text-dim)", label: t("layout.sync.local.status.none") };
}

export function setLocalSyncPaused(paused: boolean): void {
  void setLanSyncPaused(paused).catch(logFailure("lan-sync pause"));
}

export function useLocalNetworkStatus() {
  const { t } = useTranslation();
  const rows = useLanDeviceRows();
  const status = useLanSyncStore((s) => s.status);
  const pausedFlag = useLanSyncStore((s) => s.paused);
  const platform = usePlatform();
  const canPair = useCanPairDevices();

  const isPaused = pausedFlag || status === "paused";
  const anyNearby = rows.some((r) => r.nearby);
  const blocked = !isPaused && status === "blocked" && !anyNearby;
  return {
    rows,
    canPair,
    isPaused,
    anyNearby,
    hidden: status === "stopped" && rows.length === 0 && !canPair,
    running: !isPaused && !blocked && status !== "stopped",
    line: statusLine(t, isPaused, blocked, rows, platform),
    fix: blocked ? blockedFix(t, platform).action : null,
  };
}
