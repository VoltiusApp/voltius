import { useSessionStore } from "@/stores/sessionStore";
import { useIsAndroid } from "@/utils/platform";
import { useHostMetrics } from "../useHostMetrics";
import { MetricCard } from "./MetricCard";
import { DiskSection } from "./DiskSection";
import { SystemInfoSection } from "./SystemInfoSection";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB/s`;
  return `${(n / 1024 / 1024).toFixed(1)}MB/s`;
}

function fmtMem(kb: number): string {
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(0)}MB`;
  return `${(kb / 1024 / 1024).toFixed(1)}GB`;
}

export function MetricsPanel() {
  const { sessions, activeSessionId } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  // Android can't read host metrics (/proc is restricted) — only remote (SSH).
  const isAndroid = useIsAndroid();
  const localUnsupported = isAndroid && !!activeSession && activeSession.type !== "ssh";

  const { snap, disks, disksLoading, cpuH, memH, rxH, txH } = useHostMetrics(activeSession, {
    localUnsupported,
  });

  if (!activeSession || activeSession.status !== "connected") {
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
          Live metrics for this device aren't available on Android. Connect to a host over SSH to see its metrics.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Host badge */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-(--t-border) shrink-0">
        <div className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
        <span className="text-[11px] text-(--t-text-muted) truncate">
          {activeSession.connectionName}
        </span>
      </div>

      {activeSession.type === "serial" ? (
        <div className="px-4 py-3 border-b border-(--t-border) text-[11px] text-(--t-text-dim)">
          Live metrics are not available for serial sessions.
        </div>
      ) : (
        <>
          <MetricCard
            label="CPU"
            value={snap ? `${snap.cpu_percent.toFixed(1)}%` : "—"}
            color="#ef4444"
            history={cpuH}
          />
          <MetricCard
            label="RAM"
            value={
              snap
                ? `${fmtMem(snap.mem_used_kb)} / ${fmtMem(snap.mem_total_kb)}`
                : "—"
            }
            color="#22c55e"
            history={memH}
          />
          <MetricCard
            label="RX"
            value={fmtBytes(snap?.net_rx_bytes_per_sec ?? 0)}
            color="#3b82f6"
            history={rxH}
          />
          <MetricCard
            label="TX"
            value={fmtBytes(snap?.net_tx_bytes_per_sec ?? 0)}
            color="#f59e0b"
            history={txH}
          />

          {(disksLoading || disks.length > 0) && (
            <DiskSection disks={disks} loading={disksLoading} />
          )}
        </>
      )}
      <SystemInfoSection session={activeSession} />
    </div>
  );
}
