import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useSnippetStore } from "@/stores/snippetStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { runSnippetIntoSessions } from "@/services/snippetRun";
import type { Snippet } from "@/types";

/**
 * Shared snippet list. With `currentSessionId` (terminal sheet) the Insert/Execute
 * buttons run into that session immediately and the body tap opens the multi-target
 * picker; without it (snippets page) Insert/Execute/body all open the picker and a ⋮
 * opens the per-snippet actions sheet.
 */
export default function MobileSnippetList({ currentSessionId }: { currentSessionId?: string }) {
  const snippets = useSnippetStore((s) => s.snippets);
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const openSheet = useMobileNavStore((s) => s.openSheet);
  const setTab = useMobileNavStore((s) => s.setTab);
  const closeSheet = useMobileNavStore((s) => s.closeSheet);
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const inVault = snippets.filter((s) => !s.deleted_at && selectedVaultIds.includes(s.vault_id ?? "personal"));
    const q = search.trim().toLowerCase();
    return (q ? inVault.filter((s) => s.name.toLowerCase().includes(q) || s.content.toLowerCase().includes(q)) : inVault)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [snippets, selectedVaultIds, search]);

  function runCurrent(sn: Snippet, execute: boolean) {
    if (!currentSessionId) return;
    void runSnippetIntoSessions(sn, [currentSessionId], execute, {
      onNeedVars: (pi) => useSnippetStore.getState().setGlobalPendingInject(pi),
    });
    setTab("terminal");
    closeSheet();
  }
  function openPicker(snippetId: string, mode: "insert" | "execute") {
    openSheet({ kind: "snippet-target", snippetId, mode, preselectSessionId: currentSessionId });
  }

  const onInsert = (sn: Snippet) => currentSessionId ? runCurrent(sn, false) : openPicker(sn.id, "insert");
  const onExecute = (sn: Snippet) => currentSessionId ? runCurrent(sn, true) : openPicker(sn.id, "execute");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 px-3 py-2">
        <div className="flex items-center gap-2 rounded-xl px-3 h-10" style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}>
          <Icon icon="lucide:search" width={16} className="text-(--t-text-dim)" />
          <input data-mobile-snippet-search value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search snippets" className="flex-1 bg-transparent text-sm outline-none text-(--t-text-primary)" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <div className="flex flex-col items-center gap-2 pt-16 text-(--t-text-dim)">
            <Icon icon="lucide:braces" width={28} />
            <span className="text-sm">{search ? "No matches" : "No snippets yet"}</span>
          </div>
        )}
        {visible.map((sn) => (
          <div key={sn.id} className="flex items-center" data-mobile-snippet={sn.id}>
            <button className="flex-1 flex flex-col gap-0.5 px-4 py-3 text-left active:bg-(--t-bg-card) min-w-0"
              onClick={() => openPicker(sn.id, "execute")}>
              <span className="text-sm font-medium text-(--t-text-primary) truncate">{sn.name}</span>
              <span className="text-xs font-mono text-(--t-text-dim) truncate">{sn.content}</span>
            </button>
            <button className="p-2.5 text-(--t-text-secondary)" data-mobile-snippet-insert={sn.id} aria-label="Insert" onClick={() => onInsert(sn)}>
              <Icon icon="lucide:arrow-down-to-line" width={18} />
            </button>
            <button className="p-2.5 text-(--t-accent)" data-mobile-snippet-execute={sn.id} aria-label="Execute" onClick={() => onExecute(sn)}>
              <Icon icon="lucide:play" width={18} />
            </button>
            {!currentSessionId && (
              <button className="p-2.5 text-(--t-text-dim)" data-mobile-snippet-more={sn.id} aria-label="More"
                onClick={() => openSheet({ kind: "snippet-actions", snippetId: sn.id })}>
                <Icon icon="lucide:ellipsis-vertical" width={18} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
