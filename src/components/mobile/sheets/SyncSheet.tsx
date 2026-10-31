import { useState } from "react";
import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";
import PairDeviceSheet from "./PairDeviceSheet";
import { SheetActionRow, type SheetAction } from "./SheetActionRow";
import { LocalNetworkSection } from "@/components/shared/LocalNetworkSection";
import { providerLang, SyncSectionHeader } from "@/components/shared/SyncSectionParts";
import { useSyncProviders } from "@/hooks/useSyncProviders";
import { runSyncMenuAction, useSyncProviderPanel } from "@/hooks/useSyncProviderPanel";
import { splitCloudProvider, type SyncProviderAction, type SyncProviderView } from "@/services/syncProviders";
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
  const { syncNow, inactive, status, header } = useSyncProviderPanel(provider);
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
        <SyncSectionHeader variant="sheet" icon={provider.icon} label={provider.label} lang={providerLang(provider.id)} status={header} />
        {status?.reason && (
          <p data-sync-reason className="text-xs leading-relaxed break-words" style={{ color: status.color }}>
            {status.reason}
          </p>
        )}
      </div>
      {rows.map((it) => <SheetActionRow key={it.slug} attr="sync-action" it={it} />)}
    </div>
  );
}

export default function SyncSheet() {
  const { t } = useTranslation();
  const closeSheet = useMobileNavStore((s) => s.closeSheet);
  const { cloud, others } = splitCloudProvider(useSyncProviders().providers);
  const [pairing, setPairing] = useState(false);
  const onAction = (action: SyncProviderAction) => runSyncMenuAction(action, closeSheet);
  if (pairing) return <PairDeviceSheet onClose={closeSheet} />;

  return (
    <BottomSheet title={t("layout.sync.title")} onClose={closeSheet}>
      {cloud && <SyncSheetSection provider={cloud} onAction={onAction} />}
      <LocalNetworkSection variant="sheet" onClose={closeSheet} onPair={() => setPairing(true)} />
      {others.map((provider) => <SyncSheetSection key={provider.id} provider={provider} onAction={onAction} />)}
    </BottomSheet>
  );
}
