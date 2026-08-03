import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useAllSnippets } from "@/hooks/useAllSnippets";
import { useSnippetStore } from "@/stores/snippetStore";
import { snippetSearchText } from "@/services/snippetSteps";
import type { Snippet } from "@/types";

export interface SnippetChooserListProps {
  search: string;
  onPick: (snippet: Snippet) => void;
  renderActions?: (snippet: Snippet) => React.ReactNode;
  emptyAction?: React.ReactNode;
  /** Recents duplicate rows already in the list below; drop them where vertical
   *  space is tight (the host-command picker float). */
  showRecents?: boolean;
}

export function SnippetChooserList({ search, onPick, renderActions, emptyAction, showRecents = true }: SnippetChooserListProps) {
  const { t } = useTranslation();
  const snippets = useAllSnippets();
  const recentSnippetIds = useSnippetStore((s) => s.recentSnippetIds);
  const q = search.trim().toLowerCase();

  const filtered = useMemo(
    () => snippets.filter((s) =>
      !q ||
      s.name.toLowerCase().includes(q) ||
      snippetSearchText(s).toLowerCase().includes(q) ||
      s.tags.some((tag) => tag.toLowerCase().includes(q)),
    ),
    [snippets, q],
  );

  const recents = useMemo(
    () => recentSnippetIds.flatMap((id) => {
      const s = snippets.find((sn) => sn.id === id);
      return s ? [s] : [];
    }),
    [snippets, recentSnippetIds],
  );

  if (snippets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 px-4 text-center">
        <Icon icon="lucide:braces" width={28} className="text-(--t-text-dim)" />
        <p className="text-xs text-(--t-text-dim)">{t("hosts.snippetPicker.noSnippetsYet")}</p>
        {emptyAction}
      </div>
    );
  }

  if (filtered.length === 0) {
    return <p className="px-4 py-6 text-xs text-center text-(--t-text-dim)">{t("hosts.snippetPicker.noSnippetsMatch")}</p>;
  }

  return (
    <>
      {showRecents && recents.length > 0 && !q && (
        <div className="mb-0.5">
          <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-(--t-text-dim)">
            {t("hosts.snippetPicker.recent")}
          </p>
          {recents.map((s) => (
            <Row key={s.id} snippet={s} onPick={onPick} renderActions={renderActions} />
          ))}
          <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-(--t-text-dim)">
            {t("hosts.snippetPicker.allSnippets")}
          </p>
        </div>
      )}
      {filtered.map((s) => (
        <Row key={s.id} snippet={s} onPick={onPick} renderActions={renderActions} />
      ))}
    </>
  );
}

function Row({ snippet, onPick, renderActions }: {
  snippet: Snippet;
  onPick: (s: Snippet) => void;
  renderActions?: (s: Snippet) => React.ReactNode;
}) {
  return (
    <div
      onClick={renderActions ? undefined : () => onPick(snippet)}
      className={`group flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-(--t-bg-elevated) ${renderActions ? "" : "cursor-pointer"}`}
    >
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}
      >
        <Icon icon="lucide:braces" width={13} className="text-(--t-text-dim)" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate text-(--t-text-bright)">{snippet.name}</p>
        <p className="text-[11px] truncate font-mono text-(--t-text-dim)">
          {snippet.description || snippetSearchText(snippet)}
        </p>
      </div>
      {renderActions && (
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {renderActions(snippet)}
        </div>
      )}
    </div>
  );
}
