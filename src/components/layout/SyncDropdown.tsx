import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import i18n from "@/i18n";
import { useClickOutside } from "@/hooks/useClickOutside";
import type { SyncStatus } from "@/services/sync";
import { syncStatusColor } from "@/services/syncStatus";
import { runManualSync } from "@/services/syncIntent";
import { runSyncProviderAction } from "@/services/syncProviderAction";
import type { SyncProviderAction, SyncProviderView } from "@/services/syncProviders";
import { SyncStatusIcon, useSyncMotion } from "@/components/shared/SyncStatusIcon";
import { useVaultContents } from "@/hooks/useVaultContents";
import { ContentCounts } from "@/components/shared/ContentCounts";
import type { usePluginInstaller } from "@/components/settings/usePluginInstaller";
import { useAvailableSyncProviders } from "@/hooks/useAvailableSyncProviders";
import { AvailableSyncProviderRow } from "@/components/shared/AvailableSyncProviderRow";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status: SyncStatus, lastSync: Date | null): string {
  if (status === "syncing") return i18n.t("layout.sync.status.syncing");
  if (status === "success") return lastSync ? i18n.t("layout.sync.status.syncedAt", { time: formatTime(lastSync) }) : i18n.t("layout.sync.status.synced");
  if (status === "error")   return i18n.t("layout.sync.status.error");
  if (status === "offline") return i18n.t("layout.sync.status.offline");
  return i18n.t("layout.sync.status.idle");
}

// ─── Section ──────────────────────────────────────────────────────────────────

const INACTIVE_ROWS = {
  needs_upgrade: { icon: null, labelKey: "layout.sync.requiresPro", actionKey: "layout.sync.upgradeArrow", tone: "var(--t-text-dim)" },
  disabled: { icon: "lucide:puzzle", labelKey: "layout.sync.pluginDisabled", actionKey: "layout.sync.enableArrow", tone: "var(--t-text-dim)" },
  not_configured: { icon: "lucide:triangle-alert", labelKey: "layout.sync.notConfigured", actionKey: "layout.sync.configureArrow", tone: "var(--t-status-error)" },
} as const;

function SyncSection({ provider, onAction }: { provider: SyncProviderView; onAction: (action: SyncProviderAction) => void }) {
  const { t } = useTranslation();
  const isActive = provider.availability === "active";
  const engineStatus: SyncStatus = isActive ? provider.state.status : "idle";
  const [pending, setPending] = useState(engineStatus === "syncing");
  const sync = useSyncMotion(engineStatus);

  useEffect(() => {
    setPending(engineStatus === "syncing");
  }, [engineStatus]);

  const canSync = isActive && !pending && provider.syncNow !== null;

  const handleSync = () => {
    if (!canSync || !provider.syncNow) return;
    setPending(true);
    runManualSync(provider.syncNow).catch(() => {}).finally(() => setPending(false));
  };

  const act = () => {
    if (provider.action) onAction(provider.action);
  };

  const inactiveRow = provider.availability === "active" || provider.availability === "locked"
    ? null
    : INACTIVE_ROWS[provider.availability];

  return (
    <div data-sync-provider={provider.id} className="px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon icon={provider.icon} width={12} style={{ color: "var(--t-text-dim)" }} />
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--t-text-dim)" }}>
            {provider.label}
          </span>
        </div>
        <button
          onClick={handleSync}
          disabled={!canSync}
          className="flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-medium transition-all"
          style={{
            color: canSync ? "var(--t-text-secondary)" : "var(--t-text-dim)",
            background: "var(--t-bg-elevated)",
            opacity: !isActive ? 0.4 : 1,
          }}
          onMouseEnter={(e) => {
            if (canSync) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = canSync ? "var(--t-text-secondary)" : "var(--t-text-dim)";
          }}
          title={t("layout.sync.syncNow")}
        >
          <Icon icon="lucide:refresh-cw" width={10} />
          {t("layout.sync.syncNow")}
        </button>
      </div>

      {provider.availability === "locked" && (
        <button
          onClick={act}
          className="w-full flex items-center gap-1.5 text-left"
          style={{ color: "var(--t-accent)" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "0.75")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "1")}
        >
          <Icon icon="lucide:log-in" width={11} />
          <span className="text-xs">{t("layout.sync.signInForSync")}</span>
          <Icon icon="lucide:arrow-right" width={10} className="ml-auto" />
        </button>
      )}

      {inactiveRow && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5" style={{ color: inactiveRow.tone }}>
            {inactiveRow.icon && <Icon icon={inactiveRow.icon} width={11} />}
            <span className="text-xs">{t(inactiveRow.labelKey)}</span>
          </div>
          <button
            onClick={act}
            className="text-[10px] font-medium transition-opacity"
            style={{ color: "var(--t-accent)" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "0.75")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "1")}
          >
            {t(inactiveRow.actionKey)}
          </button>
        </div>
      )}

      {isActive && (() => {
        const { lastSync, error, blobSizeBytes } = provider.state;
        const { status } = sync;
        const color = syncStatusColor(status);
        return (
          <>
            <div className="flex items-center gap-1.5">
              <SyncStatusIcon sync={sync} width={12} style={{ color }} />
              <span className="text-xs" style={{ color }}>
                {statusLabel(status, lastSync)}
              </span>
            </div>
            {status === "error" && error && (
              <p className="text-[10px] leading-relaxed" style={{ color: "var(--t-status-error)" }}>
                {error}
              </p>
            )}
            {blobSizeBytes !== null && (
              <div className="flex items-center gap-1" style={{ color: "var(--t-text-muted)" }}>
                <Icon icon="lucide:lock" width={10} />
                <span className="text-[10px]">{t("layout.sync.encryptedBlob", { size: formatBytes(blobSizeBytes) })}</span>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

// ─── Entity counts ────────────────────────────────────────────────────────────

function EntityCounts() {
  return (
    <ContentCounts
      counts={useVaultContents()}
      className="px-3 py-2 flex flex-wrap gap-1.5"
      itemClassName="flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px]"
      itemStyle={{ background: "var(--t-bg-elevated)", color: "var(--t-text-secondary)", border: "1px solid var(--t-border)" }}
      iconWidth={10}
    />
  );
}

type SyncInstaller = Pick<ReturnType<typeof usePluginInstaller>, "busy" | "startInstall">;

function MoreSyncProviders({ installer }: { installer: SyncInstaller }) {
  const { t } = useTranslation();
  const { available, appVersion } = useAvailableSyncProviders();
  if (available.length === 0) return null;

  return (
    <div className="px-3 py-2.5 space-y-2" style={{ borderTop: "1px solid var(--t-border)" }}>
      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--t-text-dim)" }}>
        {t("layout.sync.moreProviders")}
      </span>
      {available.map((plugin) => (
        <AvailableSyncProviderRow
          key={plugin.id}
          compact
          plugin={plugin}
          appVersion={appVersion}
          busy={installer.busy.has(plugin.id)}
          onInstall={() => installer.startInstall(plugin)}
        />
      ))}
    </div>
  );
}

// ─── Main dropdown ────────────────────────────────────────────────────────────

interface SyncDropdownProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
  providers: SyncProviderView[];
  installer: SyncInstaller;
}

export function SyncDropdown({ anchorRef, open, onClose, providers, installer }: SyncDropdownProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  useClickOutside(panelRef, onClose, open);

  if (!open) return null;

  const onAction = (action: SyncProviderAction) => {
    onClose();
    runSyncProviderAction(action);
  };

  const anchor = anchorRef.current;
  const rect = anchor?.getBoundingClientRect();
  const right = rect ? window.innerWidth - rect.right : 8;
  const top = rect ? rect.bottom + 6 : 60;

  return (
    <div ref={panelRef} className="surface-float fixed z-50 w-64 overflow-hidden" style={{ top, right }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: "1px solid var(--t-border)" }}>
        <span className="text-xs font-semibold" style={{ color: "var(--t-text-primary)" }}>
          {t("layout.sync.title")}
        </span>
        <button
          onClick={onClose}
          className="p-0.5 rounded-sm transition-colors"
          style={{ color: "var(--t-text-dim)" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)")}
        >
          <Icon icon="lucide:x" width={13} />
        </button>
      </div>

      {providers.map((provider, i) => (
        <Fragment key={provider.id}>
          {i > 0 && <div style={{ height: 1, background: "var(--t-border)" }} />}
          <SyncSection provider={provider} onAction={onAction} />
        </Fragment>
      ))}

      <MoreSyncProviders installer={installer} />

      <div style={{ borderTop: "1px solid var(--t-border)" }}>
        <EntityCounts />
      </div>
    </div>
  );
}
