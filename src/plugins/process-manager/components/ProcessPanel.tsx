import { useCallback, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useSessionStore } from "@/stores/sessionStore";
import { useIsAndroid } from "@/utils/platform";
import { useProcessList } from "../useProcessList";
import type { ProcessEntry, SortCol } from "../types";

const ROW_H = 30;

function fmtMem(kb: number): string {
  if (kb < 1024) return `${kb}K`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(0)}M`;
  return `${(kb / 1024 / 1024).toFixed(1)}G`;
}

// ─── Column header ────────────────────────────────────────────────────────────

function ColHeader({
  label,
  col,
  sortCol,
  sortAsc,
  align = "left",
  onClick,
}: {
  label: string;
  col: SortCol;
  sortCol: SortCol;
  sortAsc: boolean;
  align?: "left" | "right";
  onClick: (col: SortCol) => void;
}) {
  const active = sortCol === col;
  return (
    <button
      onClick={() => onClick(col)}
      className="flex items-center gap-0.5 text-[10px] font-medium transition-colors"
      style={{
        color: active ? "var(--t-text-primary)" : "var(--t-text-muted)",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
      }}
    >
      {label}
      {active && (
        <Icon
          icon={sortAsc ? "lucide:chevron-up" : "lucide:chevron-down"}
          width={9}
          className="shrink-0"
        />
      )}
    </button>
  );
}

// ─── Process row ──────────────────────────────────────────────────────────────

function ProcessRow({
  entry,
  confirmPid,
  onKillRequest,
  onKillConfirm,
  onKillCancel,
}: {
  entry: ProcessEntry;
  confirmPid: number | null;
  onKillRequest: (pid: number) => void;
  onKillConfirm: (pid: number) => void;
  onKillCancel: () => void;
}) {
  const isConfirming = confirmPid === entry.pid;
  const displayName = entry.name.length > 18 ? entry.name.slice(0, 17) + "…" : entry.name;

  return (
    <div
      className="group flex items-center px-3 gap-2 border-b border-b-(--t-border)"
      style={{
        height: ROW_H,
        background: isConfirming ? "color-mix(in srgb, var(--t-status-error) 12%, transparent)" : "transparent",
      }}
      title={entry.command || entry.name}
    >
      {/* Name */}
      <span
        className="text-[11px] font-mono truncate"
        style={{
          width: 100,
          color: isConfirming ? "var(--t-status-error)" : "var(--t-text-primary)",
          flexShrink: 0,
        }}
      >
        {displayName}
      </span>

      {/* User */}
      <span
        className="text-[10px] truncate"
        style={{ width: 60, color: "var(--t-text-muted)", flexShrink: 0 }}
      >
        {entry.user}
      </span>

      {/* CPU% */}
      <span
        className="text-[10px] font-mono text-right tabular-nums"
        style={{
          width: 36,
          flexShrink: 0,
          color: entry.cpu_percent > 50 ? "var(--t-status-warning)" : entry.cpu_percent > 10 ? "var(--t-text-primary)" : "var(--t-text-muted)",
        }}
      >
        {entry.cpu_percent.toFixed(1)}%
      </span>

      {/* MEM */}
      <span
        className="text-[10px] font-mono text-right tabular-nums"
        style={{ width: 36, color: "var(--t-text-muted)", flexShrink: 0 }}
      >
        {fmtMem(entry.mem_kb)}
      </span>

      {/* Kill / confirm zone */}
      <div className="flex items-center gap-1 ml-auto shrink-0">
        {isConfirming ? (
          <>
            <button
              onClick={() => onKillConfirm(entry.pid)}
              className="text-[10px] px-1.5 py-0.5 rounded-sm font-medium"
              style={{ background: "var(--t-status-error)", color: "#fff" }}
            >
              Kill
            </button>
            <button
              onClick={onKillCancel}
              className="text-[10px] px-1.5 py-0.5 rounded-sm"
              style={{ color: "var(--t-text-muted)", background: "var(--t-bg-elevated)" }}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => onKillRequest(entry.pid)}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-sm transition-all"
            style={{ color: "var(--t-text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-status-error)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}
            title={`Kill process ${entry.pid}`}
          >
            <Icon icon="lucide:x-circle" width={11} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ProcessPanel() {
  const { sessions, activeSessionId } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  // Android restricts /proc to the app's own process — only remote (SSH) works.
  const isAndroid = useIsAndroid();
  const localUnsupported = isAndroid && !!activeSession && activeSession.type !== "ssh";

  const { snapshot, entries, filter, setFilter, sortCol, sortAsc, setSort, kill, killError, setKillError } =
    useProcessList(activeSession, localUnsupported);

  const [confirmPid, setConfirmPid] = useState<number | null>(null);

  const scrollParentRef = useRef<HTMLDivElement>(null);

  const handleSort = setSort;

  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
  });

  const handleKillConfirm = useCallback(
    (pid: number) => {
      setConfirmPid(null);
      kill(pid, false);
    },
    [kill],
  );

  if (!activeSession || activeSession.status !== "connected" || activeSession.type === "serial") {
    return (
      <div className="flex items-center justify-center h-full opacity-40">
        <p className="text-sm text-(--t-text-muted)">No active session</p>
      </div>
    );
  }

  if (localUnsupported) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="max-w-[240px] text-[11px] leading-4 text-(--t-text-muted)">
          The process list for this device isn't available on Android. Connect to a host over SSH to see its processes.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-(--t-border) shrink-0">
        <Icon icon="lucide:search" width={12} className="text-(--t-text-muted) shrink-0" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter processes…"
          className="flex-1 bg-transparent text-[11px] text-(--t-text-primary) placeholder:text-(--t-text-dim) outline-hidden"
        />
        {snapshot && (
          <span className="text-[10px] text-(--t-text-dim) shrink-0">
            {entries.length}/{snapshot.entries.length}
          </span>
        )}
      </div>

      {/* Column headers */}
      <div
        className="grid px-3 py-1 border-b border-(--t-border) shrink-0"
        style={{ gridTemplateColumns: "100px 60px 36px 36px 1fr" }}
      >
        <ColHeader label="Name"  col="name" sortCol={sortCol} sortAsc={sortAsc} onClick={handleSort} />
        <ColHeader label="User"  col="user" sortCol={sortCol} sortAsc={sortAsc} onClick={handleSort} />
        <ColHeader label="CPU"   col="cpu"  sortCol={sortCol} sortAsc={sortAsc} align="right" onClick={handleSort} />
        <ColHeader label="Mem"   col="mem"  sortCol={sortCol} sortAsc={sortAsc} align="right" onClick={handleSort} />
        <div />
      </div>

      {killError && (
        <div className="px-3 py-1.5 text-[10px] text-(--t-status-error) border-b border-(--t-border) shrink-0 flex items-center justify-between gap-2">
          <span className="truncate">{killError}</span>
          <button onClick={() => setKillError(null)} className="shrink-0">
            <Icon icon="lucide:x" width={10} />
          </button>
        </div>
      )}

      {/* Virtualized list */}
      <div ref={scrollParentRef} className="flex-1 overflow-y-auto min-h-0">
        {entries.length === 0 && snapshot ? (
          <div className="flex items-center justify-center h-16 opacity-40">
            <p className="text-[11px] text-(--t-text-muted)">No processes found</p>
          </div>
        ) : (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((vitem) => {
              const entry = entries[vitem.index];
              return (
                <div
                  key={entry.pid}
                  style={{
                    position: "absolute",
                    top: vitem.start,
                    left: 0,
                    right: 0,
                    height: ROW_H,
                  }}
                >
                  <ProcessRow
                    entry={entry}
                    confirmPid={confirmPid}
                    onKillRequest={(pid) => { setConfirmPid(pid); setKillError(null); }}
                    onKillConfirm={handleKillConfirm}
                    onKillCancel={() => setConfirmPid(null)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
