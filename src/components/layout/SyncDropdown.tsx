import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useAnchoredPopover } from "@/hooks/useAnchoredPopover";
import { runSyncMenuAction, useSyncProviderPanel } from "@/hooks/useSyncProviderPanel";
import type { SyncProviderAction, SyncProviderView } from "@/services/syncProviders";
import { SyncStatusIcon } from "@/components/shared/SyncStatusIcon";
import { useVaultContents } from "@/hooks/useVaultContents";
import { ContentCounts } from "@/components/shared/ContentCounts";
import type { usePluginInstaller } from "@/components/settings/usePluginInstaller";
import { useAvailableSyncProviders } from "@/hooks/useAvailableSyncProviders";
import { AvailableSyncProviderRow } from "@/components/shared/AvailableSyncProviderRow";
import { LocalNetworkSection } from "@/components/shared/LocalNetworkSection";
import { providerLang, SyncHeaderButton, SyncInlineAction, SyncSectionTitle } from "@/components/shared/SyncSectionParts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Section ──────────────────────────────────────────────────────────────────

function SyncSection({ provider, onAction }: { provider: SyncProviderView; onAction: (action: SyncProviderAction) => void }) {
  const { t } = useTranslation();
  const { motion, syncNow, inactive: inactiveRow, status } = useSyncProviderPanel(provider);

  const act = () => {
    if (provider.action) onAction(provider.action);
  };
  const toggle = provider.pauseToggle;

  return (
    <div data-sync-provider={provider.id} className="px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <SyncSectionTitle variant="dropdown" icon={provider.icon} label={provider.label} lang={providerLang(provider.id)} />
        <div className="flex items-stretch gap-1">
          {toggle && (
            <SyncHeaderButton onClick={() => onAction(toggle)} title={t(`layout.sync.${toggle.kind}`)}>
              <Icon icon={toggle.kind === "pause" ? "lucide:pause" : "lucide:play"} width={10} />
            </SyncHeaderButton>
          )}
          <SyncHeaderButton onClick={syncNow.run} disabled={syncNow.busy || !syncNow.available} faded={!syncNow.available} title={t("layout.sync.syncNow")}>
            <Icon icon="lucide:refresh-cw" width={10} />
            {t("layout.sync.syncNow")}
          </SyncHeaderButton>
        </div>
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
          <SyncInlineAction onClick={act} label={t(inactiveRow.actionKey)} />
        </div>
      )}

      {status && (
        <>
          <div className="flex items-center gap-1.5" style={{ color: status.color }}>
            <SyncStatusIcon sync={motion} width={12} />
            <span className="text-xs">{status.label}</span>
          </div>
          {status.reason && (
            <p className="text-[10px] leading-relaxed break-words" style={{ color: status.color }}>
              {status.reason}
            </p>
          )}
          {provider.state.blobSizeBytes !== null && (
            <div className="flex items-center gap-1" style={{ color: "var(--t-text-muted)" }}>
              <Icon icon="lucide:lock" width={10} />
              <span className="text-[10px]">{t("layout.sync.encryptedBlob", { size: formatBytes(provider.state.blobSizeBytes) })}</span>
            </div>
          )}
        </>
      )}
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
  const fade = useAnchoredPopover(open, onClose, anchorRef);

  if (!fade.mounted) return null;

  const onAction = (action: SyncProviderAction) => runSyncMenuAction(action, onClose);

  const anchor = anchorRef.current;
  const rect = anchor?.getBoundingClientRect();
  const right = rect ? window.innerWidth - rect.right : 8;
  const top = rect ? rect.bottom + 6 : 60;

  return (
    <div
      ref={fade.panelRef}
      className={`surface-float fixed z-50 w-68 overflow-hidden ${fade.className}`}
      style={{ top, right, ...fade.style }}
    >
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

      <LocalNetworkSection variant="dropdown" onClose={onClose} />

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
