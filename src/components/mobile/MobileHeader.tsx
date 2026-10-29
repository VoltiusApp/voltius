import { forwardRef } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useVaultContents } from "@/hooks/useVaultContents";
import { ContentCounts } from "@/components/shared/ContentCounts";
import { useSyncProviders } from "@/hooks/useSyncProviders";
import { syncStatusTooltip } from "@/services/syncStatusText";
import { EffectiveSyncIcon, effectiveSyncColor, useSyncMotion } from "@/components/shared/SyncStatusIcon";
import { NotificationBell } from "@/components/notifications/NotificationBell";

/** The selected vault's name + object counts, and the switcher it opens. */
function useVaultHeading() {
  const { t } = useTranslation();
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const openSheet = useMobileNavStore((s) => s.openSheet);
  const id = selectedVaultIds[0];
  const vaultName =
    vaults.find((v) => v.id === id)?.name ?? teams.find((tm) => tm.id === id)?.name ?? t("common.entity.vault");
  const counts = useVaultContents(id);
  return { vaultName, counts, openSwitcher: () => openSheet({ kind: "vault-switcher" }) };
}

/** Trailing header actions: sync status, notifications, optional "+". */
function HeaderActions({ onAdd }: { onAdd?: () => void }) {
  const { t } = useTranslation();
  const openSheet = useMobileNavStore((s) => s.openSheet);
  const sync = useSyncProviders().effective;
  const syncMotion = useSyncMotion(sync.status);
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        data-mobile-sync-status
        aria-label={syncStatusTooltip(t, sync, syncMotion.status)}
        className="vt-icon-btn"
        style={{ color: effectiveSyncColor(sync, syncMotion) }}
        onClick={() => openSheet({ kind: "sync" })}
      >
        <EffectiveSyncIcon sync={sync} motion={syncMotion} width={18} />
      </button>
      <NotificationBell />
      {onAdd && (
        <button data-mobile-add onClick={onAdd} className="vt-icon-btn -mr-2 text-(--t-text-primary)">
          <Icon icon="lucide:plus" width={22} />
        </button>
      )}
    </div>
  );
}

export default function MobileHeader({ title, onAdd }: { title?: string; onAdd?: () => void }) {
  const { vaultName, counts, openSwitcher } = useVaultHeading();
  return (
    <header
      className="shrink-0 flex items-center justify-between gap-2 px-4 py-2 border-b"
      style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}
    >
      <button data-mobile-vault-switch className="vt-hit flex flex-col items-start min-w-0" onClick={openSwitcher}>
        <span className="flex items-center gap-1.5 text-base font-semibold text-(--t-text-primary)">
          {title ?? vaultName}
          <Icon icon="lucide:chevron-down" width={16} className="text-(--t-text-dim)" />
        </span>
        {/* Vault object counts — parity with the desktop vault header. */}
        <ContentCounts counts={counts} className="flex items-center gap-2.5 mt-0.5" />
      </button>
      <HeaderActions onAdd={onAdd} />
    </header>
  );
}

/*
 * M3 large top app bar, in two parts. `MobileLargeTopBar` is the fixed 64 dp row; its
 * small title fades in from the scroll-linked `--vt-fold` var (0–1) and the bar turns
 * tonal once `data-scrolled="true"` is set on the nearest `group/appbar` ancestor
 * (see useCollapsingHeader). `MobileLargeTitle` is the big vault title at the top of
 * the scrolled content: it scrolls away under the bar.
 */
export const APPBAR_TONAL =
  "transition-colors duration-(--vt-dur-short4) ease-(--vt-ease-standard) group-data-[scrolled=true]/appbar:bg-(--t-bg-chrome)";

export function MobileLargeTopBar() {
  const { vaultName, openSwitcher } = useVaultHeading();
  return (
    <header data-mobile-appbar className={`shrink-0 h-16 flex items-center justify-between gap-2 pl-4 pr-4 bg-(--t-bg-base) ${APPBAR_TONAL}`}>
      <button
        data-mobile-vault-switch-small
        tabIndex={-1}
        aria-hidden
        onClick={openSwitcher}
        className="flex items-center gap-1 min-w-0 text-xl font-medium text-(--t-text-primary) pointer-events-none group-data-[folded=true]/appbar:pointer-events-auto"
        style={{
          opacity: "clamp(0, calc((var(--vt-fold, 0) - 0.5) * 2), 1)",
          transform: "translateY(calc((1 - clamp(0, calc((var(--vt-fold, 0) - 0.5) * 2), 1)) * 6px))",
        }}
      >
        <span className="truncate">{vaultName}</span>
        <Icon icon="lucide:chevron-down" width={18} className="shrink-0 text-(--t-text-dim)" />
      </button>
      <HeaderActions />
    </header>
  );
}

export const MobileLargeTitle = forwardRef<HTMLDivElement>(function MobileLargeTitle(_, ref) {
  const { vaultName, counts, openSwitcher } = useVaultHeading();
  return (
    <div ref={ref} data-mobile-large-title className="px-4 pt-1 pb-4">
      <button
        data-mobile-vault-switch
        className="flex flex-col items-start min-w-0 max-w-full"
        style={{ opacity: "calc(1 - var(--vt-fold, 0) * 0.6)" }}
        onClick={openSwitcher}
      >
        <span className="flex items-center gap-1.5 max-w-full text-3xl font-medium text-(--t-text-primary)">
          <span className="truncate">{vaultName}</span>
          <Icon icon="lucide:chevron-down" width={22} className="shrink-0 text-(--t-text-dim)" />
        </span>
        <ContentCounts counts={counts} className="flex items-center gap-2.5 mt-1" />
      </button>
    </div>
  );
});
