import { useState } from "react";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useProcessList } from "@/plugins/process-manager/useProcessList";
import type { ProcessEntry, SortCol } from "@/plugins/process-manager/types";
import MobilePanelHeader from "./MobilePanelHeader";
import BottomSheet from "../sheets/BottomSheet";

function fmtMem(kb: number): string {
  if (kb < 1024) return `${kb}K`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(0)}M`;
  return `${(kb / 1024 / 1024).toFixed(1)}G`;
}

const SORT_CHIPS: { col: SortCol; label: string }[] = [
  { col: "cpu", label: "CPU%" },
  { col: "mem", label: "MEM" },
  { col: "pid", label: "PID" },
  { col: "name", label: "Name" },
];

export default function MobileProcessesScreen({ sessionId }: { sessionId: string }) {
  // `.find` returns a stable element ref (or undefined) — safe selector, no fresh array.
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId));

  const { snapshot, entries, filter, setFilter, sortCol, sortAsc, setSort, kill, killError, setKillError } =
    useProcessList(session);

  const [expandedPid, setExpandedPid] = useState<number | null>(null);
  const [sheetFor, setSheetFor] = useState<ProcessEntry | null>(null);
  const [confirm, setConfirm] = useState<{ entry: ProcessEntry; force: boolean } | null>(null);

  // Mobile only streams remote (SSH) processes — the phone's own /proc is restricted.
  const ssh = session?.type === "ssh";

  const runKill = (entry: ProcessEntry, force: boolean) => {
    setConfirm(null);
    setSheetFor(null);
    void kill(entry.pid, force);
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      <MobilePanelHeader title="Processes" sessionName={session?.connectionName} />

      {!ssh ? (
        <div className="flex flex-1 items-center justify-center px-8 text-center">
          <p className="max-w-[260px] text-sm leading-5 text-(--t-text-muted)">
            The process list is only available for SSH sessions. Connect to a host over SSH to see its processes.
          </p>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-(--t-border) shrink-0">
            <Icon icon="lucide:search" width={16} className="text-(--t-text-muted) shrink-0" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter processes…"
              className="flex-1 bg-transparent text-sm text-(--t-text-primary) placeholder:text-(--t-text-dim) outline-hidden"
            />
            {snapshot && (
              <span className="text-[11px] text-(--t-text-dim) shrink-0">
                {entries.length}/{snapshot.entries.length}
              </span>
            )}
          </div>

          {/* Sort chips */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-(--t-border) shrink-0 overflow-x-auto">
            {SORT_CHIPS.map(({ col, label }) => {
              const active = sortCol === col;
              return (
                <button
                  key={col}
                  onClick={() => setSort(col)}
                  className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium"
                  style={{
                    background: active ? "var(--t-bg-card)" : "transparent",
                    color: active ? "var(--t-text-primary)" : "var(--t-text-dim)",
                    border: "1px solid var(--t-border)",
                  }}
                >
                  {label}
                  {active && (
                    <Icon icon={sortAsc ? "lucide:chevron-up" : "lucide:chevron-down"} width={12} />
                  )}
                </button>
              );
            })}
          </div>

          {killError && (
            <div className="px-3 py-2 text-xs text-(--t-status-error) border-b border-(--t-border) shrink-0 flex items-center justify-between gap-2">
              <span className="break-all">{killError}</span>
              <button onClick={() => setKillError(null)} className="shrink-0 p-1">
                <Icon icon="lucide:x" width={14} />
              </button>
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {entries.length === 0 ? (
              <div className="flex flex-1 items-center justify-center px-8 py-10 text-center text-(--t-text-dim)">
                <p className="text-sm">{snapshot ? "No processes found" : "Loading processes…"}</p>
              </div>
            ) : (
              entries.map((e) => {
                const expanded = expandedPid === e.pid;
                return (
                  <div key={e.pid} className="border-b border-(--t-border)">
                    <button
                      data-mobile-process={e.pid}
                      onClick={() => setSheetFor(e)}
                      onContextMenu={(ev) => {
                        ev.preventDefault();
                        setExpandedPid((p) => (p === e.pid ? null : e.pid));
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-(--t-bg-card) min-w-0"
                    >
                      <span className="shrink-0 w-12 text-[11px] font-mono text-(--t-text-dim) tabular-nums">
                        {e.pid}
                      </span>
                      <span className="flex flex-col min-w-0 flex-1">
                        <span
                          className={`text-sm font-mono text-(--t-text-primary) ${expanded ? "break-all" : "truncate"}`}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setExpandedPid((p) => (p === e.pid ? null : e.pid));
                          }}
                        >
                          {expanded ? e.command || e.name : e.name}
                        </span>
                        <span className="text-[11px] text-(--t-text-dim) truncate">{e.user}</span>
                      </span>
                      <span
                        className="shrink-0 w-14 text-right text-xs font-mono tabular-nums"
                        style={{
                          color:
                            e.cpu_percent > 50
                              ? "var(--t-status-warning)"
                              : e.cpu_percent > 10
                                ? "var(--t-text-primary)"
                                : "var(--t-text-muted)",
                        }}
                      >
                        {e.cpu_percent.toFixed(1)}%
                      </span>
                      <span className="shrink-0 w-12 text-right text-xs font-mono text-(--t-text-muted) tabular-nums">
                        {fmtMem(e.mem_kb)}
                      </span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Action sheet */}
      {sheetFor && (
        <BottomSheet title={`${sheetFor.name} · ${sheetFor.pid}`} onClose={() => setSheetFor(null)}>
          <div className="flex flex-col">
            <SheetRow
              icon="lucide:x-circle"
              label="Kill (SIGTERM)"
              onClick={() => setConfirm({ entry: sheetFor, force: false })}
            />
            <SheetRow
              icon="lucide:zap"
              label="Force kill (SIGKILL)"
              danger
              onClick={() => setConfirm({ entry: sheetFor, force: true })}
            />
          </div>
        </BottomSheet>
      )}

      {/* Confirm */}
      {confirm && (
        <BottomSheet
          title={confirm.force ? "Force kill process?" : "Kill process?"}
          onClose={() => setConfirm(null)}
        >
          <div className="flex flex-col gap-3 px-2 py-1">
            <p className="text-xs text-(--t-text-dim)">
              {confirm.force ? "SIGKILL" : "SIGTERM"} will be sent to {confirm.entry.name} (pid {confirm.entry.pid}).
            </p>
            <button
              data-mobile-process-kill-confirm
              onClick={() => runKill(confirm.entry, confirm.force)}
              className="w-full rounded-xl py-3 text-sm font-medium"
              style={{ background: "var(--t-status-error)", color: "#fff" }}
            >
              {confirm.force ? "Force kill" : "Kill"}
            </button>
            <button
              onClick={() => setConfirm(null)}
              className="w-full rounded-xl py-3 text-sm text-(--t-text-primary)"
              style={{ background: "var(--t-bg-card)" }}
            >
              Cancel
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

function SheetRow({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      data-mobile-process-action={label}
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-3 text-left active:bg-(--t-bg-card)"
      style={{ color: danger ? "var(--t-status-error)" : "var(--t-text-primary)" }}
    >
      <Icon icon={icon} width={18} />
      <span className="text-sm">{label}</span>
    </button>
  );
}
