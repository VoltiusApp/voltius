import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Checkbox } from "@/components/import-export/shared";
import { AvatarTile } from "@/components/shared/AvatarTile";
import type { CatalogEntry } from "@/services/snippetCatalog";
import { resolveSelection } from "@/services/snippetCatalogSelection";
import { StepPreview } from "./StepPreview";
import { useCommunityInstall } from "./useCommunityInstall";

export function EntryDetail({ entry, onBack, onInstalled }: {
  entry: CatalogEntry;
  onBack: () => void;
  onInstalled: (count: number) => void;
}) {
  const { t } = useTranslation();
  const { install, installing, vault } = useCommunityInstall();
  const allEids = useMemo(() => entry.snippets.map(s => s._eid ?? ""), [entry]);
  const [picked, setPicked] = useState<string[]>(allEids);
  const [error, setError] = useState<string | null>(null);

  const { selected, autoIncluded } = useMemo(() => resolveSelection(entry, picked), [entry, picked]);
  const autoByEid = new Map(autoIncluded.map(a => [a.eid, a]));
  const nameOfEid = (eid: string) => entry.snippets.find(s => s._eid === eid)?.name ?? eid;
  const isPack = entry.kind === "pack";

  const toggle = (eid: string) =>
    setPicked(prev => prev.includes(eid) ? prev.filter(e => e !== eid) : [...prev, eid]);

  async function handleInstall() {
    setError(null);
    try {
      const result = await install([{ entry, snippetEids: selected }]);
      if (result.errors > 0 && result.imported === 0) {
        setError(t("snippets.community.installFailed", { error: `${result.errors}` }));
        return;
      }
      onInstalled(selected.length);
    } catch (e) {
      setError(t("snippets.community.installFailed", { error: String((e as Error)?.message ?? e) }));
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs self-start text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
      >
        <Icon icon="lucide:arrow-left" width={14} />
        {t("snippets.community.back")}
      </button>

      <div className="flex items-start gap-3">
        <AvatarTile icon={isPack ? "lucide:package" : "lucide:code"} iconSize={18} className="w-11 h-11 rounded-xl" />
        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="text-base font-bold text-(--t-text-bright)">{entry.name}</h2>
          <p className="text-xs text-(--t-text-muted)">
            {[
              entry.author ? t("snippets.community.by", { author: entry.author }) : null,
              entry.updated_at ? t("snippets.community.updated", { date: entry.updated_at }) : null,
              isPack ? t("snippets.community.snippetCount", { count: entry.snippets.length }) : null,
            ].filter(Boolean).join(" · ")}
          </p>
          {entry.description && <p className="text-xs text-(--t-text-secondary) mt-1">{entry.description}</p>}
        </div>
      </div>

      {isPack && (
        <div className="flex items-center gap-3">
          <button className="text-xs text-(--t-text-dim) hover:text-(--t-text-primary)" onClick={() => setPicked(allEids)}>
            {t("snippets.community.selectAll")}
          </button>
          <button className="text-xs text-(--t-text-dim) hover:text-(--t-text-primary)" onClick={() => setPicked([])}>
            {t("snippets.community.selectNone")}
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
        {entry.snippets.map((snippet) => {
          const eid = snippet._eid ?? "";
          const auto = autoByEid.get(eid);
          const included = selected.includes(eid);
          return (
            <div
              key={eid}
              className="rounded-xl p-3 flex flex-col gap-2"
              style={{
                background: "var(--t-bg-card)",
                border: "1px solid var(--t-border)",
                opacity: isPack && !included ? 0.5 : 1,
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                {isPack && <Checkbox checked={included} onChange={() => toggle(eid)} label="" />}
                <span className="text-sm font-semibold text-(--t-text-bright) truncate flex-1 min-w-0">{snippet.name}</span>
              </div>
              {snippet.description && <p className="text-xs text-(--t-text-dim)">{snippet.description}</p>}
              {auto && (
                <p className="text-xs flex items-center gap-1.5 text-(--t-text-muted)">
                  <Icon icon="lucide:link" width={11} className="shrink-0" />
                  {t("snippets.community.autoIncluded", { name: auto.becauseOf })}
                </p>
              )}
              <StepPreview steps={snippet.steps} nameOfEid={nameOfEid} />
            </div>
          );
        })}
      </div>

      {error && (
        <p className="text-xs flex items-start gap-1.5" style={{ color: "var(--t-status-error)" }}>
          <Icon icon="lucide:circle-alert" width={12} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <button
        onClick={handleInstall}
        disabled={installing || selected.length === 0}
        className="self-start px-4 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
        style={{ background: "var(--t-accent)", color: "var(--t-accent-fg)" }}
      >
        {installing
          ? t("snippets.community.installing")
          : t("snippets.community.install", { count: selected.length, vault: vault.name })}
      </button>
    </div>
  );
}
