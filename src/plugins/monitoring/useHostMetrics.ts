import { useCallback, useEffect, useRef, useState } from "react";
import { metricsStart, metricsStop, onMetricsSnapshot } from "@/services/metrics";
import type { DiskInfo, MetricsSnapshot } from "./types";
import type { TerminalSession } from "@/types";

const MAX_HISTORY = 60;

function pushHistory(arr: number[], val: number): number[] {
  const next = [...arr, val];
  if (next.length > MAX_HISTORY) next.shift();
  return next;
}

/** Live host metrics for one session, with cpu/mem/rx/tx sparkline buffers + disk snapshot.
 *  Streams only while connected, non-serial, not unsupported, and not paused. The stream is
 *  started with `isRemote = session.type === "ssh"` (matching the desktop MetricsPanel).
 *  Shared by desktop MetricsPanel + mobile Metrics screen. */
export function useHostMetrics(
  session: TerminalSession | undefined,
  opts: { paused?: boolean; localUnsupported?: boolean } = {},
) {
  const paused = opts.paused ?? false;
  const localUnsupported = opts.localUnsupported ?? false;

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
    if (
      !session ||
      session.status !== "connected" ||
      session.type === "serial" ||
      localUnsupported ||
      paused
    ) {
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
        const sid = await metricsStart(session.id, session.type === "ssh");
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
  }, [session?.id, session?.status, session?.type, localUnsupported, paused]);

  return { snap, disks, disksLoading, cpuH, memH, rxH, txH };
}
