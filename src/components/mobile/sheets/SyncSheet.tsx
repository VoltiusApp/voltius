import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";
import { SheetActionRow, type SheetAction } from "./SheetActionRow";
import { LocalNetworkSection } from "@/components/shared/LocalNetworkSection";
import { providerLang, SyncSectionTitle } from "@/components/shared/SyncSectionParts";
import { SyncStatusIcon } from "@/components/shared/SyncStatusIcon";
import { useSyncProviders } from "@/hooks/useSyncProviders";
import { runSyncMenuAction, useSyncProviderPanel } from "@/hooks/useSyncProviderPanel";
import type { SyncProviderAction, SyncProviderView } from "@/services/syncProviders";
import { useMobileNavStore } from "@/stores/mobileNavStore";

const ACTION_ICONS: Record<SyncProviderAction["kind"], string> = {
  signIn: "lucide:log-in",
  upgrade: "lucide:badge-check",
  pause: "lucide:pause",
  resume: "lucide:play",
  enable: "lucide:puzzle",
  configure: "lucide:settings",
};

function SyncSheetSection({ provider, onAction }: { provider: SyncProviderView; onAction: (action: SyncProviderAction) => void }) {
  const { t } = useTranslation();
  const { motion, syncNow, inactive, status } = useSyncProviderPanel(provider);
  const { action, pauseToggle } = provider;

  const actionRow = (a: SyncProviderAction, label: string): SheetAction =>
    ({ icon: ACTION_ICONS[a.kind], label, slug: a.kind, onTap: () => onAction(a) });
  const rows: SheetAction[] = [];
  if (syncNow.available) {
    rows.push({ icon: "lucide:refresh-cw", label: t("layout.sync.syncNow"), slug: "sync-now", disabled: syncNow.busy, onTap: syncNow.run });
  }
  if (pauseToggle) rows.push(actionRow(pauseToggle, t(`layout.sync.${pauseToggle.kind}`)));
  if (action && action.kind !== pauseToggle?.kind) {
    rows.push(actionRow(action, t(inactive ? inactive.actionKey : "layout.sync.signInForSync")));
  }

  return (
    <div data-sync-provider={provider.id} className="pb-1">
      <div className="px-3 pt-2 pb-1 space-y-1.5">
        <SyncSectionTitle variant="sheet" icon={provider.icon} label={provider.label} lang={providerLang(provider.id)} />
        {status && (
          <>
            <div className="flex items-center gap-2" style={{ color: status.color }}>
              <SyncStatusIcon sync={motion} width={16} />
              <span className="text-sm">{status.label}</span>
            </div>
            {status.reason && (
              <p data-sync-reason className="text-xs leading-relaxed break-words" style={{ color: status.color }}>
                {status.reason}
              </p>
            )}
          </>
        )}
        {inactive && (
          <div className="flex items-center gap-2" style={{ color: inactive.tone }}>
            {inactive.icon && <Icon icon={inactive.icon} width={16} />}
            <span className="text-sm">{t(inactive.labelKey)}</span>
          </div>
        )}
      </div>
      {rows.map((it) => <SheetActionRow key={it.slug} attr="sync-action" it={it} />)}
    </div>
  );
}

export default function SyncSheet() {
  const { t } = useTranslation();
  const closeSheet = useMobileNavStore((s) => s.closeSheet);
  const { providers } = useSyncProviders();
  const onAction = (action: SyncProviderAction) => runSyncMenuAction(action, closeSheet);

  return (
    <BottomSheet title={t("layout.sync.title")} onClose={closeSheet}>
      <LocalNetworkSection variant="sheet" onClose={closeSheet} />
      {providers.map((provider) => <SyncSheetSection key={provider.id} provider={provider} onAction={onAction} />)}
    </BottomSheet>
  );
}
