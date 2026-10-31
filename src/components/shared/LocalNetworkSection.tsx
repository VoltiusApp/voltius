import { Fragment, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Icon } from "@iconify/react";
import { SheetActionRow, type SheetAction } from "@/components/mobile/sheets/SheetActionRow";
import { LanConfirmPrompt } from "@/components/shared/LanConfirmPrompt";
import { LanForgetPrompt } from "@/components/shared/LanForgetPrompt";
import { openPairDeviceDialog } from "@/stores/pairDeviceDialogStore";
import { useAsyncFlag } from "@/hooks/useNoAccountInstall";
import { setLocalSyncPaused, useLocalNetworkStatus } from "@/hooks/useLocalNetworkStatus";
import { SyncHeaderButton, SyncInlineAction, SyncSectionHeader, type SyncMenuVariant } from "@/components/shared/SyncSectionParts";
import { runSyncMenuAction } from "@/hooks/useSyncProviderPanel";
import { usePlanDisplay } from "@/services/planDisplay";
import { inLanGroup, leaveLanGroup } from "@/services/lanSync";
import type { DeviceDot, DeviceRow } from "@/services/lanSyncDevices";
import { SYNC_NEARBY_ICON } from "@/services/syncStatus";
import { formatRelative } from "@/utils/localeFormat";
import { deviceIcon } from "@/utils/icons";
import { routeLabel } from "@/services/myDevices";

const STYLES = {
  dropdown: {
    section: "px-3 py-2.5 space-y-2 border-b border-(--t-border)",
    list: "flex flex-col gap-1.5 p-2 rounded-lg",
    row: "gap-2",
    rowIcon: 13,
    name: "text-xs",
    detail: "text-[10px]",
    note: "text-[10px]",
  },
  sheet: {
    section: "px-3 pt-2 pb-1 space-y-1.5",
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
  alert: { background: "var(--t-status-warning)" },
  "offline-ok": { boxShadow: "inset 0 0 0 1.5px var(--t-text-muted)" },
};

function rowDetail(t: TFunction, row: DeviceRow, anyNearby: boolean): { text: string; color: string } {
  if (row.flag) {
    return { text: t(`layout.sync.local.row.${row.flag}`), color: row.dot === "alert" ? "var(--t-status-warning)" : "var(--t-text-dim)" };
  }
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

function DeviceRowView({ row, anyNearby, variant, onForget }: { row: DeviceRow; anyNearby: boolean; variant: SyncMenuVariant; onForget: () => void }) {
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
      <span className={`${s.name} flex-1 min-w-[35%] truncate`} style={{ color: row.nearby ? "var(--t-text-primary)" : "var(--t-text-secondary)" }} title={row.name}>
        {row.name}
      </span>
      <span className={`${s.detail} min-w-0 max-w-[65%] ${row.flag ? "text-right leading-snug" : "truncate"}`} style={{ color: detail.color }} title={detail.text}>
        {detail.text}
      </span>
      <span aria-hidden data-dot={row.dot} className="shrink-0 size-1.5 rounded-full" style={DOT_STYLE[row.dot]} />
      <button
        data-lan-forget={row.deviceId}
        onClick={onForget}
        title={t("layout.sync.local.forget.aria", { name: row.name })}
        aria-label={t("layout.sync.local.forget.aria", { name: row.name })}
        className={`shrink-0 grid place-items-center text-(--t-text-muted) hover:text-(--t-text-primary) ${variant === "sheet" ? "size-11 -mr-3" : "size-5 -mr-1"}`}
      >
        <Icon icon="lucide:x" width={s.rowIcon} />
      </button>
    </div>
  );
}

export function LocalNetworkSection({ variant, onClose, onPair }: { variant: SyncMenuVariant; onClose: () => void; onPair?: () => void }) {
  const { t } = useTranslation();
  const { rows, canPair, isPaused, anyNearby, running, line, fix: openSettings, hidden } = useLocalNetworkStatus();
  const { showUpgrade } = usePlanDisplay();
  const inGroup = useAsyncFlag(inLanGroup);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  if (hidden) return null;

  const s = STYLES[variant];
  const sheet = variant === "sheet";
  const catchUp = running && !anyNearby && rows.length > 0;
  const upsell = running && showUpgrade && rows.some((r) => r.dot === "behind");

  const toggle: SheetAction = {
    slug: isPaused ? "resume" : "pause",
    icon: isPaused ? "lucide:play" : "lucide:pause",
    label: t(isPaused ? "layout.sync.local.resume" : "layout.sync.local.pause"),
    onTap: () => setLocalSyncPaused(!isPaused),
  };
  const pair: SheetAction | null = canPair
    ? { slug: "pair", icon: "lucide:link", label: t("layout.sync.local.pair.title"), onTap: onPair ?? (() => { onClose(); openPairDeviceDialog(); }) }
    : null;
  const leave: SheetAction | null = canPair && inGroup
    ? { slug: "leave", icon: "lucide:log-out", label: t("layout.sync.local.leave.label"), onTap: () => setLeaving(true) }
    : null;
  const forgetRow = rows.find((r) => r.deviceId === forgetting);
  const upgrade: SheetAction | null = upsell
    ? { slug: "upgrade", icon: "lucide:badge-check", label: t("layout.sync.upgradeArrow"), onTap: () => runSyncMenuAction({ kind: "upgrade" }, onClose) }
    : null;
  const note = `${s.note} leading-relaxed text-(--t-text-dim)`;

  return (
    <div data-lan-section className={sheet ? "pb-1" : undefined}>
      <div className={s.section}>
        <SyncSectionHeader variant={variant} icon={SYNC_NEARBY_ICON} label={t("layout.sync.local.title")} status={line}>
          {!sheet && (
            <SyncHeaderButton onClick={toggle.onTap} title={toggle.label}>
              <Icon icon={toggle.icon} width={10} />
            </SyncHeaderButton>
          )}
        </SyncSectionHeader>
        {!sheet && openSettings && <SyncInlineAction onClick={openSettings.onTap} label={openSettings.label} />}
        {!sheet && (pair || leave) && (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {[pair, leave].map((a) => a && <SyncInlineAction key={a.slug} slug={a.slug} onClick={a.onTap} label={a.label} />)}
          </div>
        )}

        {rows.length > 0 && (
          <div className={s.list} style={{ background: "var(--t-bg-input)", opacity: isPaused ? 0.6 : 1 }}>
            {rows.map((row, i) => (
              <Fragment key={row.deviceId}>
                {!row.nearby && rows[i - 1]?.nearby && <div data-divider className="h-px my-0.5 bg-(--t-border)" />}
                <DeviceRowView row={row} anyNearby={anyNearby} variant={variant} onForget={() => setForgetting(row.deviceId)} />
              </Fragment>
            ))}
          </div>
        )}

        {forgetRow && <LanForgetPrompt key={forgetRow.deviceId} row={forgetRow} variant={variant} onDone={() => setForgetting(null)} />}
        {leaving && (
          <LanConfirmPrompt
            kind="leave"
            variant={variant}
            icon="lucide:log-out"
            label={t("layout.sync.local.leave.confirm")}
            failed={t("layout.sync.local.leave.failed")}
            run={() => leaveLanGroup("left")}
            onDone={onClose}
            onCancel={() => setLeaving(false)}
          >
            <p>{t("layout.sync.local.leave.prompt")}</p>
          </LanConfirmPrompt>
        )}
        {catchUp && <p className={note}>{t("layout.sync.local.catchUp")}</p>}
        {upgrade && (
          <p data-lan-upsell className={note}>
            {t("layout.sync.local.upsell")}
            {!sheet && <> <SyncInlineAction onClick={upgrade.onTap} label={upgrade.label} /></>}
          </p>
        )}
      </div>
      {sheet && [toggle, pair, leave, openSettings, upgrade].map((a) => a && <SheetActionRow key={a.slug} attr="lan-action" it={a} />)}
    </div>
  );
}
