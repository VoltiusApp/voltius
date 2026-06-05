import { writeClipboard } from "../../utils/clipboard";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useCommandHistoryStore, type CommandHistoryEntry } from "@/stores/commandHistoryStore";
import { useSessionStore } from "@/stores/sessionStore";
import { broadcastSnippetInject } from "@/services/snippets";

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function HistoryRow({
  entry,
  canInject,
  onInsert,
  onExecute,
  onCopy,
  onDelete,
}: {
  entry: CommandHistoryEntry;
  canInject: boolean;
  onInsert: () => void;
  onExecute: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    onCopy();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div
      className="group px-3 py-2 border-b transition-colors"
      style={{ borderColor: "var(--t-border)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex-1 min-w-0">
          <p
            className="text-[11px] font-mono leading-tight break-all"
            style={{ color: "var(--t-text-primary)" }}
            title={entry.command}
          >
            {entry.command}
          </p>
          <p
            className="text-[10px] mt-1 truncate"
            style={{ color: "var(--t-text-muted)" }}
          >
            {entry.sessionName} · {formatRelativeTime(entry.timestamp)}
          </p>
        </div>

        <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
          <button
            onClick={handleCopy}
            title={copied ? "Copied" : "Copy"}
            className="w-6 h-6 flex items-center justify-center rounded transition-colors"
            style={{ color: copied ? "var(--t-accent)" : "var(--t-text-muted)" }}
            onMouseEnter={(e) => { if (!copied) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
            onMouseLeave={(e) => { if (!copied) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
          >
            <Icon icon={copied ? "lucide:check" : "lucide:copy"} width={12} />
          </button>
          <button
            onClick={onInsert}
            disabled={!canInject}
            title={canInject ? "Insert" : "No active session"}
            className="w-6 h-6 flex items-center justify-center rounded transition-colors disabled:opacity-30"
            style={{ color: "var(--t-text-muted)" }}
            onMouseEnter={(e) => { if (canInject) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
            onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"}
          >
            <Icon icon="lucide:arrow-down-to-line" width={13} />
          </button>
          <button
            onClick={onExecute}
            disabled={!canInject}
            title={canInject ? "Insert & execute" : "No active session"}
            className="w-6 h-6 flex items-center justify-center rounded transition-colors disabled:opacity-30"
            style={{ color: "var(--t-text-muted)" }}
            onMouseEnter={(e) => { if (canInject) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-accent)"; }}
            onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"}
          >
            <Icon icon="lucide:play" width={13} />
          </button>
          <button
            onClick={onDelete}
            title="Remove from history"
            className="w-6 h-6 flex items-center justify-center rounded transition-colors opacity-0 group-hover:opacity-100"
            style={{ color: "var(--t-text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-status-error)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}
          >
            <Icon icon="lucide:x" width={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function HistoryPanel() {
  const entries = useCommandHistoryStore((s) => s.entries);
  const clear = useCommandHistoryStore((s) => s.clear);
  const remove = useCommandHistoryStore((s) => s.remove);
  const { sessions, activeSessionId } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [filterCurrent, setFilterCurrent] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const canInject = !!activeSession && activeSession.type !== "multiplayer";

  useEffect(() => {
    const focus = () => { searchRef.current?.focus(); searchRef.current?.select(); };
    window.addEventListener("voltius:focus-panel-search", focus);
    return () => window.removeEventListener("voltius:focus-panel-search", focus);
  }, []);

  const filtered = useMemo(() => {
    let list = entries;
    if (filterCurrent && activeSession) {
      list = list.filter((e) => e.connectionId === activeSession.connectionId);
    }
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(
        (e) =>
          e.command.toLowerCase().includes(q) ||
          e.sessionName.toLowerCase().includes(q),
      );
    }
    return [...list].reverse();
  }, [entries, query, filterCurrent, activeSession]);

  async function inject(text: string, execute: boolean) {
    if (!activeSession || activeSession.type === "multiplayer") return;
    try {
      await broadcastSnippetInject(activeSession.id, activeSession.type, text, execute);
    } catch (e) {
      console.error("history inject failed:", e);
    }
  }

  function handleCopy(text: string) {
    writeClipboard(text).catch(() => {});
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search + actions */}
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0" style={{ borderColor: "var(--t-border)" }}>
        <div className="flex-1 relative">
          <Icon icon="lucide:search" width={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--t-text-muted)" }} />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search history…"
            className="w-full pl-6 pr-2 py-1 text-xs rounded border outline-none"
            style={{ background: "var(--t-bg-input)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
        </div>
        <button
          onClick={() => setFilterCurrent((v) => !v)}
          title={filterCurrent ? "Showing current connection only" : "Show all connections"}
          disabled={!activeSession}
          className="w-7 h-7 flex items-center justify-center rounded-lg shrink-0 disabled:opacity-30"
          style={{ color: filterCurrent ? "var(--t-accent)" : "var(--t-text-muted)" }}
          onMouseEnter={(e) => { if (!filterCurrent && activeSession) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
          onMouseLeave={(e) => { if (!filterCurrent && activeSession) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
        >
          <Icon icon="lucide:filter" width={13} />
        </button>
        {!confirmClear ? (
          <button
            onClick={() => setConfirmClear(true)}
            disabled={entries.length === 0}
            title="Clear all history"
            className="w-7 h-7 flex items-center justify-center rounded-lg shrink-0 disabled:opacity-30"
            style={{ color: "var(--t-text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-status-error)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}
          >
            <Icon icon="lucide:trash-2" width={13} />
          </button>
        ) : (
          <button
            onClick={() => { clear(); setConfirmClear(false); }}
            onBlur={() => setConfirmClear(false)}
            autoFocus
            className="h-7 px-2 text-[10px] font-semibold rounded-lg shrink-0"
            style={{ background: "var(--t-status-error)", color: "white" }}
          >
            Confirm
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 py-8 opacity-40">
            <Icon icon="lucide:clock" width={24} style={{ color: "var(--t-text-muted)" }} />
            <p className="text-xs text-center" style={{ color: "var(--t-text-muted)" }}>
              {query
                ? "No commands match"
                : filterCurrent
                ? "No history for this connection yet"
                : "No command history yet.\nCommands you type will appear here."}
            </p>
          </div>
        )}

        {filtered.map((entry) => (
          <HistoryRow
            key={entry.id}
            entry={entry}
            canInject={canInject}
            onInsert={() => inject(entry.command, false)}
            onExecute={() => inject(entry.command, true)}
            onCopy={() => handleCopy(entry.command)}
            onDelete={() => remove(entry.id)}
          />
        ))}
      </div>
    </div>
  );
}
