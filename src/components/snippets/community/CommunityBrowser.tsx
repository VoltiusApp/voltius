import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { FilterInput } from "@/components/shared/ToolbarViewControls";
import { Pills } from "@/components/shared/Pills";
import { fetchCatalog } from "@/services/snippetCatalogFetch";
import type { CatalogEntry } from "@/services/snippetCatalog";
import { EntryCard } from "./EntryCard";
import { EntryDetail } from "./EntryDetail";

function Section({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
          {label}
          <span className="ml-2 font-normal normal-case tracking-normal">{count}</span>
        </p>
      </div>
      {children}
    </div>
  );
}

export function CommunityBrowser({ layout, onLayoutChange, onInstalled }: {
  layout: "grid" | "list";
  onLayoutChange: (v: "grid" | "list") => void;
  onInstalled: (count: number) => void;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    fetchCatalog()
      .then(({ entries, fromCache }) => {
        if (cancelled) return;
        setEntries(entries);
        setFromCache(fromCache);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String((e as Error)?.message ?? e));
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !entries) return entries ?? [];
    return entries.filter(e =>
      [e.name, e.description ?? "", e.author ?? "", ...e.tags].some(v => v.toLowerCase().includes(q)));
  }, [entries, search]);

  const open = entries?.find(e => e.id === openId);
  if (open) {
    return <EntryDetail entry={open} onBack={() => setOpenId(null)} onInstalled={onInstalled} />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <Icon icon="lucide:cloud-off" width={28} className="text-(--t-text-dim)" />
        <p className="text-sm text-(--t-text-muted)">{t("snippets.community.loadFailed")}</p>
        <button
          onClick={() => setReloadKey(k => k + 1)}
          className="text-xs px-3 py-1.5 rounded-lg text-(--t-text-primary)"
          style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}
        >
          {t("snippets.community.retry")}
        </button>
      </div>
    );
  }

  if (!entries) {
    return <p className="text-sm text-(--t-text-dim) py-16 text-center">{t("snippets.community.loading")}</p>;
  }

  const packs = filtered.filter(e => e.kind === "pack");
  const singles = filtered.filter(e => e.kind === "snippet");
  const gridClass = layout === "grid" ? "grid gap-4" : "flex flex-col gap-1";
  const gridStyle = layout === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" } : undefined;

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="flex items-center gap-3">
        <FilterInput value={search} onChange={setSearch} placeholder={t("snippets.community.searchPlaceholder")} width={200} />
        <Pills
          options={[
            { value: "grid" as const, label: t("common.viewMode.grid"), icon: "lucide:layout-grid" },
            { value: "list" as const, label: t("common.viewMode.list"), icon: "lucide:layout-list" },
          ]}
          value={layout}
          onChange={onLayoutChange}
        />
        {fromCache && (
          <span className="text-xs flex items-center gap-1.5 text-(--t-text-dim)">
            <Icon icon="lucide:cloud-off" width={12} />
            {t("snippets.community.offline")}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="text-sm text-(--t-text-dim) py-16 text-center">
            {entries.length === 0 ? t("snippets.community.empty") : t("snippets.community.noResults", { search })}
          </p>
        ) : (
          <>
            <Section label={t("snippets.community.packs")} count={packs.length}>
              <div className={gridClass} style={gridStyle}>
                {packs.map(e => <EntryCard key={e.id} entry={e} layout={layout} onOpen={() => setOpenId(e.id)} />)}
              </div>
            </Section>
            <Section label={t("snippets.community.snippets")} count={singles.length}>
              <div className={gridClass} style={gridStyle}>
                {singles.map(e => <EntryCard key={e.id} entry={e} layout={layout} onOpen={() => setOpenId(e.id)} />)}
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
