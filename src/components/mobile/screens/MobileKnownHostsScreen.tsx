import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import MobilePanelHeader from "../panels/MobilePanelHeader";
import MobileFilterBar from "../MobileFilterBar";
import KnownHostActionsSheet from "../sheets/KnownHostActionsSheet";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { useKnownHostStore } from "@/stores/knownHostStore";
import type { KnownHost } from "@/types";

function truncateFp(fp: string): string {
  const i = fp.indexOf(":");
  if (i !== -1) { const h = fp.slice(i + 1); return fp.slice(0, i + 1) + (h.length > 16 ? h.slice(0, 16) + "…" : h); }
  return fp.length > 22 ? fp.slice(0, 22) + "…" : fp;
}

export default function MobileKnownHostsScreen() {
  const { t } = useTranslation();
  const knownHosts = useKnownHostStore((s) => s.knownHosts);
  const [search, setSearch] = useState("");
  const [sheetHost, setSheetHost] = useState<KnownHost | null>(null);
  useEffect(() => { void useKnownHostStore.getState().loadKnownHosts(); }, []);
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() =>
    [...knownHosts]
      .filter((h) => !q || h.host.toLowerCase().includes(q) || (h.name ?? "").toLowerCase().includes(q))
      .sort((a, b) => (a.host + a.port).localeCompare(b.host + b.port)),
    [knownHosts, q]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      <MobilePanelHeader title={t("mobile.morePages.knownHosts")} />
      <MobileFilterBar value={search} onChange={setSearch} placeholder={t("mobile.knownHostsScreen.filterPlaceholder")} />
      <div className="flex-1 overflow-y-auto pb-4">
        {filtered.length === 0 ? (
          <p className="text-center text-sm text-(--t-text-dim) px-6 py-16">
            {q ? t("mobile.knownHostsScreen.noSearchMatches") : t("mobile.knownHostsScreen.empty")}
          </p>
        ) : filtered.map((h) => (
          <button key={h.id} data-knownhost-row className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-(--t-bg-card)"
            onClick={() => setSheetHost(h)}>
            <AvatarTile icon="lucide:fingerprint-pattern" iconSize={18} className="w-10 h-10 rounded-xl shrink-0" />
            <span className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium text-(--t-text-primary) truncate">{h.name ?? `${h.host}:${h.port}`}</span>
              <span className="text-xs text-(--t-text-dim) font-mono truncate">{truncateFp(h.fingerprint)}</span>
            </span>
          </button>
        ))}
      </div>
      {sheetHost && <KnownHostActionsSheet host={sheetHost} onClose={() => setSheetHost(null)} />}
    </div>
  );
}
