import { useEffect } from "react";
import { Icon } from "@iconify/react";
import BottomSheet from "./BottomSheet";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetTargetPicker } from "@/hooks/useSnippetTargetPicker";
import { runSnippetIntoSessions } from "@/services/snippetRun";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { connectionDisplayName } from "@/utils/connectionDisplayName";

export default function MobileSnippetTargetSheet(
  { snippetId, mode, preselectSessionId }: { snippetId: string; mode: "insert" | "execute"; preselectSessionId?: string },
) {
  const closeSheet = useMobileNavStore((s) => s.closeSheet);
  const setTab = useMobileNavStore((s) => s.setTab);
  const snippet = useSnippetStore((s) => s.snippets.find((x) => x.id === snippetId));
  const p = useSnippetTargetPicker();

  // Pre-select the terminal's current session once (multi-target path from the terminal sheet).
  useEffect(() => {
    if (preselectSessionId) p.toggleSession(preselectSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!snippet) return null;

  const execute = mode === "execute";
  const confirmLabel = `${execute ? "Execute in" : "Insert to"} ${p.totalSelected} target${p.totalSelected !== 1 ? "s" : ""}`;

  async function go() {
    const sn = snippet!;
    await p.confirm((ids) => {
      if (ids.length === 0) return;
      void runSnippetIntoSessions(sn, ids, execute, {
        onNeedVars: (pi) => useSnippetStore.getState().setGlobalPendingInject(pi),
      });
    });
    setTab("terminal");
    closeSheet();
  }

  return (
    <BottomSheet title={`${execute ? "Execute" : "Insert"} "${snippet.name}"`} onClose={closeSheet} registerBack={false}>
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-xl px-3 h-10" style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}>
          <Icon icon="lucide:search" width={16} className="text-(--t-text-dim)" />
          <input data-snippet-target-search value={p.search} onChange={(e) => p.setSearch(e.target.value)} placeholder="Filter…"
            className="flex-1 bg-transparent text-sm outline-none text-(--t-text-primary)" />
        </div>
      </div>

      {p.filteredSessions.length > 0 && (
        <>
          <p className="px-4 py-1 text-[10px] font-bold uppercase tracking-widest text-(--t-text-dim)">Active Sessions</p>
          {p.filteredSessions.map((s) => {
            const sel = p.selectedSessionIds.has(s.id);
            return (
              <button key={s.id} data-snippet-target-session={s.id}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left active:bg-(--t-bg-card)"
                onClick={() => p.toggleSession(s.id)}>
                <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: sel ? "var(--t-accent)" : "var(--t-bg-elevated)", color: sel ? "#fff" : "var(--t-text-dim)" }}>
                  <Icon icon={sel ? "lucide:check" : "lucide:terminal"} width={15} />
                </span>
                <span className="flex-1 text-sm font-medium text-(--t-text-primary) truncate">{s.connectionName}</span>
              </button>
            );
          })}
        </>
      )}

      <p className="px-4 py-1 text-[10px] font-bold uppercase tracking-widest text-(--t-text-dim)">Open New Connection</p>
      {p.filteredHosts.map((c) => {
        const sel = p.selectedConnectionIds.has(c.id);
        return (
          <button key={c.id} data-snippet-target-host={c.id}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left active:bg-(--t-bg-card)"
            onClick={() => p.toggleConnection(c.id)}>
            {sel
              ? <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--t-accent)" }}><Icon icon="lucide:check" width={15} className="text-white" /></span>
              : <ConnectionAvatar connection={c} size={28} />}
            <span className="flex-1 text-sm font-medium text-(--t-text-primary) truncate">{connectionDisplayName(c)}</span>
          </button>
        );
      })}
      {p.filteredHosts.length === 0 && <p className="px-4 py-3 text-xs text-(--t-text-dim)">No hosts</p>}

      {p.totalSelected > 0 && (
        <div className="sticky bottom-0 px-3 pt-2 pb-[env(safe-area-inset-bottom)]" style={{ background: "var(--t-bg-modal)" }}>
          <button data-snippet-target-confirm onClick={() => void go()}
            className="w-full h-11 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
            style={{ background: "var(--t-accent)", color: "#fff" }}>
            <Icon icon={execute ? "lucide:play" : "lucide:arrow-down-to-line"} width={16} />
            {confirmLabel}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
