import { useEffect, useState } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { useHostMetrics } from "@/plugins/monitoring/useHostMetrics";
import { Sparkline } from "@/plugins/monitoring/components/Sparkline";
import { sshGetSystemInfo, type SystemInfo } from "@/services/ssh";
import MobilePanelHeader from "./MobilePanelHeader";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB/s`;
  return `${(n / 1024 / 1024).toFixed(1)}MB/s`;
}

function fmtMem(kb: number): string {
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(0)}MB`;
  return `${(kb / 1024 / 1024).toFixed(1)}GB`;
}

function MobileMetricCard({ label, value, color, history }: {
  label: string;
  value: string;
  color: string;
  history: number[];
}) {
  return (
    <div className="rounded-xl border border-(--t-border) bg-(--t-bg-elevated) px-4 pt-3 pb-2">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-(--t-text-dim)">
          {label}
        </span>
        <span className="text-sm font-mono font-semibold text-(--t-text-bright)">{value}</span>
      </div>
      <Sparkline data={history} color={color} height={48} />
    </div>
  );
}

export default function MobileMetricsScreen({ sessionId }: { sessionId: string }) {
  // `.find` returns a stable ref for unchanged sessions — safe selector (no fresh array).
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId));

  // Pause the metrics stream while the app is backgrounded to save the SSH channel.
  const [paused, setPaused] = useState(() => document.visibilityState === "hidden");
  useEffect(() => {
    const onVis = () => setPaused(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const { snap, disks, cpuH, memH, rxH, txH } = useHostMetrics(session, { paused });

  const ssh = session?.type === "ssh";

  // System info (OS / kernel / arch) — one remote probe once the SSH session is up.
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  useEffect(() => {
    if (!ssh || session?.status !== "connected") return;
    let cancelled = false;
    sshGetSystemInfo(sessionId).then((info) => { if (!cancelled) setSysInfo(info); }).catch(() => {});
    return () => { cancelled = true; };
  }, [ssh, session?.status, sessionId]);

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--t-bg-base)" }}>
      <MobilePanelHeader title="Metrics" sessionName={session?.connectionName} />

      {!ssh ? (
        <div className="flex flex-1 items-center justify-center px-8 text-center">
          <p className="max-w-[260px] text-sm leading-5 text-(--t-text-muted)">
            Live metrics are only available for SSH sessions. Connect to a host over SSH to see its metrics.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {sysInfo && (
            <div className="rounded-xl border border-(--t-border) bg-(--t-bg-elevated) px-4 pt-3 pb-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-(--t-text-dim) mb-1.5">
                System
              </p>
              <p className="text-sm font-medium text-(--t-text-bright) truncate">
                {sysInfo.pretty_name || "Unknown OS"}
              </p>
              {sysInfo.kernel && (
                <p className="text-xs font-mono text-(--t-text-muted) mt-0.5 truncate">
                  {sysInfo.kernel} · {sysInfo.arch}
                </p>
              )}
            </div>
          )}
          <MobileMetricCard
            label="CPU"
            value={snap ? `${snap.cpu_percent.toFixed(1)}%` : "—"}
            color="#ef4444"
            history={cpuH}
          />
          <MobileMetricCard
            label="Memory"
            value={snap ? `${fmtMem(snap.mem_used_kb)} / ${fmtMem(snap.mem_total_kb)}` : "—"}
            color="#22c55e"
            history={memH}
          />
          <MobileMetricCard
            label="Net RX"
            value={fmtBytes(snap?.net_rx_bytes_per_sec ?? 0)}
            color="#3b82f6"
            history={rxH}
          />
          <MobileMetricCard
            label="Net TX"
            value={fmtBytes(snap?.net_tx_bytes_per_sec ?? 0)}
            color="#f59e0b"
            history={txH}
          />

          {disks.length > 0 && (
            <div className="rounded-xl border border-(--t-border) bg-(--t-bg-elevated) px-4 pt-3 pb-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-(--t-text-dim) mb-2">
                Disks
              </p>
              {disks.map((disk) => {
                const pct = disk.total_kb > 0 ? Math.round((disk.used_kb / disk.total_kb) * 100) : 0;
                const barColor =
                  pct > 90 ? "var(--t-status-error)" : pct > 75 ? "#f59e0b" : "var(--t-accent)";
                return (
                  <div key={disk.mount} className="mb-2.5 last:mb-0">
                    <div className="flex justify-between text-[12px] mb-1">
                      <span className="font-mono text-(--t-text-secondary) truncate max-w-[160px]">
                        {disk.mount}
                      </span>
                      <span className="text-(--t-text-muted) shrink-0 ml-2">
                        {fmtMem(disk.used_kb)} / {fmtMem(disk.total_kb)}
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-(--t-bg-input) overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: barColor }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
