import { Fragment, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Icon } from "@iconify/react";
import { SheetActionRow, type SheetAction } from "@/components/mobile/sheets/SheetActionRow";
import { SyncHeaderButton, SyncInlineAction, SyncSectionTitle, type SyncMenuVariant } from "@/components/shared/SyncSectionParts";
import { useLanDeviceRows } from "@/hooks/useLanDeviceRows";
import { runSyncMenuAction } from "@/hooks/useSyncProviderPanel";
import { logFailure } from "@/lib/logger";
import { CAN_OPEN_CHECKOUT } from "@/services/distribution";
import { setLanSyncPaused } from "@/services/lanSync";
import type { DeviceDot, DeviceRow } from "@/services/lanSyncDevices";
import { SYNC_PAUSED_ICON } from "@/services/syncStatus";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { formatRelative } from "@/utils/localeFormat";
import { usePlatform } from "@/utils/platform";
import { deviceIcon } from "@/utils/icons";
import { routeLabel } from "@/services/myDevices";
import { blockedFix } from "@/services/lanBlockedFix";

const STYLES = {
  dropdown: {
    section: "px-3 py-2.5 space-y-2 border-b border-(--t-border)",
    statusIcon: 12,
    status: "text-xs",
    list: "flex flex-col gap-1.5 p-2 rounded-lg",
    row: "gap-2",
    rowIcon: 13,
    name: "text-xs",
    detail: "text-[10px]",
    note: "text-[10px]",
  },
  sheet: {
    section: "px-3 pt-2 pb-1 space-y-1.5",
    statusIcon: 16,
    status: "text-sm",
    list: "flex flex-col px-3 rounded-xl",
    row: "min-h-11 gap-3",
    rowIcon: 16,
    name: "text-sm",
    detail: "text-xs",
    note: "text-xs",
  },
} as const;

const DOT_STYLE: Record<DeviceDot, CSSProperties> = {
  live: { background: "var(--t-status-connected)" },
  syncing: { background: "var(--t-accent)", boxShadow: "0 0 0 3px color-mix(in srgb, var(--t-accent) 20%, transparent)" },
  behind: { background: "var(--t-status-warning)" },
  "offline-ok": { boxShadow: "inset 0 0 0 1.5px var(--t-text-muted)" },
};

function statusLine(t: TFunction, paused: boolean, blocked: boolean, rows: DeviceRow[], platform: string | null): { icon: string; color: string; label: string; spin?: boolean } {
  if (paused) return { icon: SYNC_PAUSED_ICON, color: "var(--t-text-dim)", label: t("layout.sync.local.status.paused") };
  if (blocked) return blockedFix(t, platform);
  const syncing = rows.find((r) => r.dot === "syncing");
  if (syncing) return { icon: "lucide:loader-circle", color: "var(--t-accent)", spin: true, label: t("layout.sync.local.status.syncing", { name: syncing.name }) };
  const nearby = rows.filter((r) => r.nearby).length;
  if (nearby > 0) return { icon: "lucide:circle-check", color: "var(--t-status-connected)", label: t("layout.sync.local.status.live", { count: nearby }) };
  return { icon: "lucide:wifi", color: "var(--t-text-dim)", label: t("layout.sync.local.status.none") };
}

function rowDetail(t: TFunction, row: DeviceRow, anyNearby: boolean): { text: string; color: string } {
  const count = row.behind;
  if (row.dot === "syncing") {
    return { text: t(count > 0 ? "layout.sync.local.row.syncing" : "layout.sync.status.syncing", { count }), color: "var(--t-accent)" };
  }
  if (row.dot === "live") return { text: routeLabel(t, row.route ?? "lan"), color: "var(--t-text-dim)" };
  const when = !anyNearby && row.lastSeen ? formatRelative(row.lastSeen) : null;
  if (row.dot === "behind") {
    const text = when ? t("layout.sync.local.row.seenBehind", { when, count }) : t("layout.sync.local.row.behind", { count });
    return { text, color: "var(--t-status-warning)" };
  }
  return { text: when ? t("layout.sync.local.row.seenOk", { when }) : t("layout.sync.local.row.offlineOk"), color: "var(--t-text-dim)" };
}

function DeviceRowView({ row, anyNearby, variant }: { row: DeviceRow; anyNearby: boolean; variant: SyncMenuVariant }) {
  const { t } = useTranslation();
  const s = STYLES[variant];
  const detail = rowDetail(t, row, anyNearby);
  return (
    <div data-lan-device={row.deviceId} data-offline={row.nearby ? undefined : ""} className={`flex items-center ${s.row}`}>
      <Icon
        icon={deviceIcon(row.platform)}
        width={s.rowIcon}
        className="shrink-0"
        style={{ color: row.nearby ? "var(--t-text-secondary)" : "var(--t-text-muted)" }}
      />
      <span className={`${s.name} flex-1 min-w-0 truncate`} style={{ color: row.nearby ? "var(--t-text-primary)" : "var(--t-text-secondary)" }} title={row.name}>
        {row.name}
      </span>
      <span className={`${s.detail} max-w-[65%] truncate`} style={{ color: detail.color }} title={detail.text}>
        {detail.text}
      </span>
      <span aria-hidden data-dot={row.dot} className="shrink-0 size-1.5 rounded-full" style={DOT_STYLE[row.dot]} />
    </div>
  );
}

export function LocalNetworkSection({ variant, onClose }: { variant: SyncMenuVariant; onClose: () => void }) {
  const { t } = useTranslation();
  const rows = useLanDeviceRows();
  const status = useLanSyncStore((s) => s.status);
  const pausedFlag = useLanSyncStore((s) => s.paused);
  const isPro = useSubscriptionStore((s) => s.isPro);
  const platform = usePlatform();
  if (status === "stopped" && rows.length === 0) return null;

  const isPaused = pausedFlag || status === "paused";

  const s = STYLES[variant];
  const sheet = variant === "sheet";
  const anyNearby = rows.some((r) => r.nearby);
  const blocked = !isPaused && status === "blocked" && !anyNearby;
  const running = !isPaused && !blocked && status !== "stopped";
  const line = statusLine(t, isPaused, blocked, rows, platform);
  const catchUp = running && !anyNearby && rows.length > 0;
  const upsell = running && !isPro && CAN_OPEN_CHECKOUT && rows.some((r) => r.dot === "behind");

  const toggle: SheetAction = {
    slug: isPaused ? "resume" : "pause",
    icon: isPaused ? "lucide:play" : "lucide:pause",
    label: t(isPaused ? "layout.sync.local.resume" : "layout.sync.local.pause"),
    onTap: () => void setLanSyncPaused(!isPaused).catch(logFailure("lan-sync pause")),
  };
  const openSettings = blocked ? blockedFix(t, platform).action : null;
  const upgrade: SheetAction | null = upsell
    ? { slug: "upgrade", icon: "lucide:badge-check", label: t("layout.sync.upgradeArrow"), onTap: () => runSyncMenuAction({ kind: "upgrade" }, onClose) }
    : null;
  const note = `${s.note} leading-relaxed text-(--t-text-dim)`;

  return (
    <div data-lan-section className={sheet ? "pb-1" : undefined}>
      <div className={s.section}>
        <div className="flex items-center justify-between gap-2">
          <SyncSectionTitle variant={variant} icon="lucide:wifi" label={t("layout.sync.local.title")} />
          {!sheet && (
            <SyncHeaderButton onClick={toggle.onTap} title={toggle.label}>
              <Icon icon={toggle.icon} width={10} />
            </SyncHeaderButton>
          )}
        </div>

        <div className={`flex items-start ${sheet ? "gap-2" : "gap-1.5"}`} style={{ color: line.color }}>
          <Icon icon={line.icon} width={s.statusIcon} className={`shrink-0 mt-0.5 ${line.spin ? "motion-safe:animate-spin" : ""}`} />
          <span className={`${s.status} leading-snug`}>{line.label}</span>
        </div>
        {!sheet && openSettings && <SyncInlineAction onClick={openSettings.onTap} label={openSettings.label} />}

        {rows.length > 0 && (
          <div className={s.list} style={{ background: "var(--t-bg-input)", opacity: isPaused ? 0.6 : 1 }}>
            {rows.map((row, i) => (
              <Fragment key={row.deviceId}>
                {!row.nearby && rows[i - 1]?.nearby && <div data-divider className="h-px my-0.5 bg-(--t-border)" />}
                <DeviceRowView row={row} anyNearby={anyNearby} variant={variant} />
              </Fragment>
            ))}
          </div>
        )}

        {catchUp && <p className={note}>{t("layout.sync.local.catchUp")}</p>}
        {upgrade && (
          <p data-lan-upsell className={note}>
            {t("layout.sync.local.upsell")}
            {!sheet && <> <SyncInlineAction onClick={upgrade.onTap} label={upgrade.label} /></>}
          </p>
        )}
      </div>
      {sheet && [toggle, openSettings, upgrade].map((a) => a && <SheetActionRow key={a.slug} attr="lan-action" it={a} />)}
    </div>
  );
}
