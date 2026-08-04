import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { BaseCard } from "@/components/shared/BaseCard";
import { AvatarTile } from "@/components/shared/AvatarTile";
import type { CatalogEntry } from "@/services/snippetCatalog";

export function EntryCard({ entry, layout, onOpen }: {
  entry: CatalogEntry;
  layout: "grid" | "list";
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const icon = entry.kind === "pack" ? "lucide:package" : "lucide:code";
  const meta = [
    entry.author ? t("snippets.community.by", { author: entry.author }) : null,
    entry.kind === "pack" ? t("snippets.community.snippetCount", { count: entry.snippets.length }) : null,
  ].filter(Boolean).join(" · ");

  if (layout === "list") {
    return (
      <BaseCard isList onClick={onOpen} data-card>
        <AvatarTile icon={icon} iconSize={14} className="w-8 h-8 rounded-lg" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-(--t-text-bright) truncate block">{entry.name}</span>
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            {meta && <span className="text-xs text-(--t-text-muted) truncate">{meta}</span>}
            {entry.description && (
              <>
                <span className="text-xs text-(--t-text-dim)">·</span>
                <span className="text-xs text-(--t-text-dim) truncate">{entry.description}</span>
              </>
            )}
          </div>
        </div>
        <Icon icon="lucide:chevron-right" width={14} className="shrink-0 text-(--t-text-dim)" />
      </BaseCard>
    );
  }

  return (
    <BaseCard isList={false} onClick={onOpen} data-card>
      <div className="flex-1 min-w-0 self-start flex flex-col gap-2.5">
        <div className="flex items-start gap-2 min-w-0">
          <AvatarTile icon={icon} iconSize={14} className="w-7 h-7 rounded-lg" />
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <p className="text-sm font-bold truncate text-(--t-text-bright)">{entry.name}</p>
            {meta && <p className="text-xs text-(--t-text-muted) truncate">{meta}</p>}
          </div>
        </div>
        {entry.description && (
          <p className="text-xs text-(--t-text-dim) line-clamp-2">{entry.description}</p>
        )}
        {entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entry.tags.slice(0, 3).map(tag => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded text-(--t-text-dim)"
                style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </BaseCard>
  );
}
