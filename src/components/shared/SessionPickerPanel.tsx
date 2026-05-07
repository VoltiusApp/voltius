import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useUIStore } from "@/stores/uiStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { matchesSearch } from "@/utils/connectionFilter";
import { ConnectionAvatar } from "./ConnectionAvatar";
import { HostRow } from "./HostPickerPanel";
import { getSnippetInjectionTargetIds, waitForConnectedSessionIds } from "./sessionPickerTargets";

interface Props {
  mode: "insert" | "execute";
  onConfirm: (sessionIds: string[]) => void;
  onClose: () => void;
}

export function SessionPickerPanel({ mode, onConfirm, onClose }: Props) {
  const { sessions } = useSessionStore();
  const { connections } = useConnectionStore();
  const [search, setSearch] = useState("");
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(new Set());

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status === "connected" && s.type !== "multiplayer"),
    [sessions],
  );

  const filteredSessions = useMemo(
    () => !search
      ? activeSessions
      : activeSessions.filter((s) => s.connectionName.toLowerCase().includes(search.toLowerCase())),
    [activeSessions, search],
  );

  const filteredHosts = useMemo(
    () => connections
      .filter((c) => c.connection_type !== "serial")
      .filter((c) => matchesSearch(c, search)),
    [connections, search],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggleSession(id: string) {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleConnection(id: string) {
    setSelectedConnectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const totalSelected = selectedSessionIds.size + selectedConnectionIds.size;

  async function handleConfirm() {
    const sessionIds = [...selectedSessionIds];
    const pickedConnections = connections.filter((c) => selectedConnectionIds.has(c.id));

    // Inject into already-connected sessions immediately
    onConfirm(sessionIds);

    const newSessionIds = pickedConnections.length > 0
      ? await useSessionStore.getState().connectMany(pickedConnections.map((conn) => conn.id)).catch(() => [])
      : [];

    const allSessionIds = getSnippetInjectionTargetIds(sessionIds, newSessionIds);

    if (allSessionIds.length > 0) {
      useUIStore.getState().setActiveNav("terminal" as any);

      if (allSessionIds.length === 1) {
        useSessionStore.getState().setActive(allSessionIds[0]);
      } else {
        const layout = useLayoutStore.getState();
        layout.openSessions(allSessionIds);
        useSessionStore.getState().setActive(allSessionIds[0]);
      }
    }

    if (newSessionIds.length > 0) {
      void waitForConnectedSessionIds(
        newSessionIds,
        () => useSessionStore.getState().sessions,
        (listener) => useSessionStore.subscribe(listener),
      ).then(onConfirm);
    }

    onClose();
  }

  const label = mode === "insert" ? "Insert to..." : "Execute in...";
  const confirmLabel = mode === "insert"
    ? `Insert to ${totalSelected} target${totalSelected !== 1 ? "s" : ""}`
    : `Execute in ${totalSelected} target${totalSelected !== 1 ? "s" : ""}`;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-72 z-50 flex flex-col bg-[var(--t-bg-base)] border-l border-[var(--t-bg-terminal)] shadow-xl">
        <div className="flex items-center gap-2 px-3 py-3 shrink-0 bg-[var(--t-bg-card)] border-b border-[var(--t-bg-terminal)]">
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0 text-[var(--t-text-dim)]"
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-elevated)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
          >
            <Icon icon="lucide:x" width={14} />
          </button>
          <h2 className="text-sm font-semibold flex-1 text-[var(--t-text-primary)]">{label}</h2>
        </div>

        <div className="px-2 py-2 shrink-0 bg-[var(--t-bg-toolbar)] border-b border-[var(--t-bg-terminal)]">
          <div className="relative">
            <Icon icon="lucide:search" width={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--t-text-dim)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter..."
              autoFocus
              className="w-full pl-8 pr-2 h-8 rounded-lg text-xs outline-none bg-[var(--t-bg-input)] border border-[var(--t-border)] text-[var(--t-text-primary)]"
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1.5 px-2">
          {activeSessions.length === 0 && !search && (
            <p className="px-3 py-3 text-xs text-[var(--t-text-muted)]">No active sessions</p>
          )}

          {filteredSessions.length > 0 && (
            <>
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-dim)]">
                Active Sessions
              </p>
              {filteredSessions.map((s) => (
                <HostRow
                  key={s.id}
                  avatar={
                    <div
                      className="rounded-lg flex items-center justify-center shrink-0 w-[1.867rem] h-[1.867rem] transition-colors"
                      style={{
                        background: selectedSessionIds.has(s.id) ? "var(--t-accent)" : "var(--t-bg-elevated)",
                        color: selectedSessionIds.has(s.id) ? "#fff" : "var(--t-text-dim)",
                      }}
                    >
                      <Icon icon={selectedSessionIds.has(s.id) ? "lucide:check" : "lucide:terminal"} width={13} />
                    </div>
                  }
                  name={s.connectionName}
                  sub={s.type === "local" ? "Local Machine" : "SSH Session"}
                  isSelected={selectedSessionIds.has(s.id)}
                  onClick={() => toggleSession(s.id)}
                />
              ))}
              <div className="mx-2 my-1.5 border-t border-[var(--t-bg-terminal)]" />
            </>
          )}

          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-dim)]">
            Open New Connection
          </p>

          {filteredHosts.length === 0 && (
            <p className="px-3 py-4 text-xs text-center text-[var(--t-text-muted)]">No hosts found</p>
          )}

          {filteredHosts.map((c) => (
            <HostRow
              key={c.id}
              avatar={
                selectedConnectionIds.has(c.id)
                  ? (
                    <div className="rounded-lg flex items-center justify-center shrink-0 w-[1.867rem] h-[1.867rem]" style={{ background: "var(--t-accent)" }}>
                      <Icon icon="lucide:check" width={13} className="text-white" />
                    </div>
                  )
                  : <ConnectionAvatar connection={c} size={28} />
              }
              name={c.name ?? `${c.username}@${c.host}`}
              sub={`${c.username}@${c.host}:${c.port}`}
              isSelected={selectedConnectionIds.has(c.id)}
              onClick={() => toggleConnection(c.id)}
            />
          ))}
        </div>

        {totalSelected > 0 && (
          <div className="shrink-0 px-3 py-3 border-t border-[var(--t-bg-terminal)] bg-[var(--t-bg-card)]">
            <button
              onClick={() => void handleConfirm()}
              className="w-full h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-opacity"
              style={{ background: "var(--t-accent)", color: "#fff" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <Icon icon={mode === "insert" ? "lucide:skip-forward" : "lucide:play"} width={14} />
              {confirmLabel}
            </button>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
