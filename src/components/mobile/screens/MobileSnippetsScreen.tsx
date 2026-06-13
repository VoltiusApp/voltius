import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useSnippetStore } from "@/stores/snippetStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useSessionStore } from "@/stores/sessionStore";
import { runSnippetIntoActiveSession, isRunnableSession } from "@/services/snippetRun";
import MobileHeader from "../MobileHeader";
import SnippetTargetSheet from "../sheets/SnippetTargetSheet";

export default function MobileSnippetsScreen() {
  const snippets = useSnippetStore((s) => s.snippets);
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const push = useMobileNavStore((s) => s.push);
  const setTab = useMobileNavStore((s) => s.setTab);
  const setActive = useSessionStore((s) => s.setActive);
  const hasConnected = useSessionStore((s) => s.sessions.some((x) => x.status === "connected"));
  // Primitive count (stable) — only the >1 gate needs it; the picker re-derives the list.
  const runnableCount = useSessionStore((s) => s.sessions.filter(isRunnableSession).length);
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<{ snippetId: string; name: string } | null>(null);

  const visible = useMemo(() => {
    const inVault = snippets.filter((s) => !s.deleted_at && selectedVaultIds.includes(s.vault_id ?? "personal"));
    const q = search.trim().toLowerCase();
    return (q ? inVault.filter((s) => s.name.toLowerCase().includes(q) || s.content.toLowerCase().includes(q)) : inVault)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [snippets, selectedVaultIds, search]);

  // Direct run into a specific session (or the default first-connected when no
  // sessionId is given). Preserves the original behavior: jump to the terminal
  // tab on success.
  const doRun = (snippetId: string, sessionId?: string) => {
    const sn = snippets.find((s) => s.id === snippetId);
    if (!sn) return;
    if (runSnippetIntoActiveSession(sn, sessionId)) setTab("terminal");
  };
  // Gate: a single (or no) connected session runs directly; multiple connected
  // sessions open the target picker so the snippet can't fire into the wrong one.
  const run = (id: string) => {
    const sn = snippets.find((s) => s.id === id);
    if (!sn) return;
    if (runnableCount <= 1) { doRun(id); return; }
    setConfirm({ snippetId: id, name: sn.name });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <MobileHeader onAdd={() => push({ kind: "snippet-edit" })} />
      <div className="shrink-0 px-3 py-2">
        <div
          className="flex items-center gap-2 rounded-xl px-3 h-10"
          style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}
        >
          <Icon icon="lucide:search" width={16} className="text-(--t-text-dim)" />
          <input
            data-mobile-snippet-search
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search snippets"
            className="flex-1 bg-transparent text-sm outline-none text-(--t-text-primary)"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <div className="flex flex-col items-center gap-2 pt-16 text-(--t-text-dim)">
            <Icon icon="lucide:braces" width={28} />
            <span className="text-sm">{search ? "No matches" : "No snippets yet — tap + to add one"}</span>
          </div>
        )}
        {visible.map((sn) => (
          <div key={sn.id} className="flex items-center" data-mobile-snippet={sn.id}>
            <button
              className="flex-1 flex flex-col gap-0.5 px-4 py-3 text-left active:bg-(--t-bg-card) min-w-0"
              onClick={() => run(sn.id)}
              disabled={!hasConnected}
              style={{ opacity: hasConnected ? 1 : 0.5 }}
            >
              <span className="text-sm font-medium text-(--t-text-primary) truncate">{sn.name}</span>
              <span className="text-xs font-mono text-(--t-text-dim) truncate">{sn.content}</span>
            </button>
            <button className="p-3 text-(--t-text-dim)" data-mobile-snippet-edit={sn.id}
              onClick={() => push({ kind: "snippet-edit", snippetId: sn.id })}>
              <Icon icon="lucide:pencil" width={16} />
            </button>
          </div>
        ))}
        {!hasConnected && visible.length > 0 && (
          <div className="px-4 py-3 text-xs text-(--t-text-dim)">Connect to a host to run snippets.</div>
        )}
      </div>
      {confirm && (
        <SnippetTargetSheet
          snippetName={confirm.name}
          onClose={() => setConfirm(null)}
          onPick={(sessionId) => { setActive(sessionId); doRun(confirm.snippetId, sessionId); }}
        />
      )}
    </div>
  );
}
