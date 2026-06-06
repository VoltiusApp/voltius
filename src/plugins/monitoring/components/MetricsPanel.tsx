import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { metricsStart, metricsStop, onMetricsSnapshot } from "@/services/metrics";
import type { DiskInfo, MetricsSnapshot } from "../types";
import { MetricCard } from "./MetricCard";
import { DiskSection } from "./DiskSection";
import { SystemInfoSection } from "./SystemInfoSection";

const MAX_HISTORY = 60;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB/s`;
  return `${(n / 1024 / 1024).toFixed(1)}MB/s`;
}

function fmtMem(kb: number): string {
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(0)}MB`;
  return `${(kb / 1024 / 1024).toFixed(1)}GB`;
}

function pushHistory(arr: number[], val: number): number[] {
  const next = [...arr, val];
  if (next.length > MAX_HISTORY) next.shift();
  return next;
}

export function MetricsPanel() {
  const { sessions, activeSessionId } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const streamIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const [snap, setSnap] = useState<MetricsSnapshot | null>(null);
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [disksLoading, setDisksLoading] = useState(false);
  const [cpuH, setCpuH] = useState<number[]>([]);
  const [memH, setMemH] = useState<number[]>([]);
  const [rxH, setRxH] = useState<number[]>([]);
  const [txH, setTxH] = useState<number[]>([]);

  const stopStream = useCallback(async () => {
    unlistenRef.current?.();
    unlistenRef.current = null;
    if (streamIdRef.current) {
      await metricsStop(streamIdRef.current).catch(() => {});
      streamIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!activeSession || activeSession.status !== "connected" || activeSession.type === "serial") {
      stopStream();
      setSnap(null);
      setCpuH([]);
      setMemH([]);
      setRxH([]);
      setTxH([]);
      setDisks([]);
      setDisksLoading(false);
      return;
    }

    let cancelled = false;
    setDisks([]);
    setDisksLoading(true);

    (async () => {
      await stopStream();
      if (cancelled) return;

      try {
        const sid = await metricsStart(activeSession.id, activeSession.type === "ssh");
        if (cancelled) { metricsStop(sid).catch(() => {}); return; }
        streamIdRef.current = sid;

        const unlisten = await onMetricsSnapshot(sid, (s) => {
          if (cancelled) return;
          setSnap(s);
          setCpuH((h) => pushHistory(h, s.cpu_percent));
          setMemH((h) => pushHistory(h, s.mem_total_kb > 0 ? (s.mem_used_kb / s.mem_total_kb) * 100 : 0));
          setRxH((h) => pushHistory(h, s.net_rx_bytes_per_sec));
          setTxH((h) => pushHistory(h, s.net_tx_bytes_per_sec));
          if (s.disks) {
            setDisks(s.disks);
            setDisksLoading(false);
          }
        });

        if (cancelled) { unlisten(); metricsStop(sid).catch(() => {}); return; }
        unlistenRef.current = unlisten;
      } catch (e) {
        console.error("[monitoring] metrics_start failed:", e);
        if (!cancelled) setDisksLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, activeSession?.status, activeSession?.type]);

  if (!activeSession || activeSession.status !== "connected") {
    return (
      <div className="flex items-center justify-center h-full opacity-40">
        <p className="text-sm text-(--t-text-muted)">No active session</p>
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
