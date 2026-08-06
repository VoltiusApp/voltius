import { useEffect, useState } from "react";
import { Icon, useT, useSessionById } from "@voltius/ui";
import type { FC } from "react";
import type { PluginAPI, MobileScreenProps } from "@/plugins/api";
import { createMetricsService } from "../services";
import { useHostMetrics } from "../useHostMetrics";
import { Sparkline } from "./Sparkline";
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

export function createMobileMetricsScreen(api: PluginAPI): FC<MobileScreenProps> {
  const service = createMetricsService(api.metrics);

  return function MobileMetricsScreen({ sessionId, onBack }) {
    const t = useT(api);
    const session = useSessionById(api, sessionId);

    // Pause the metrics stream while the app is backgrounded to save the SSH channel.
    const [paused, setPaused] = useState(() => document.visibilityState === "hidden");
    useEffect(() => {
      const onVis = () => setPaused(document.visibilityState === "hidden");
      document.addEventListener("visibilitychange", onVis);
      return () => document.removeEventListener("visibilitychange", onVis);
    }, []);

    const { snap, disks, disksLoading, cpuH, memH, rxH, txH } = useHostMetrics(service, session ?? undefined, {
      paused,
    });

    const ssh = session?.type === "ssh";

    return (
      <div className="flex flex-col h-full" style={{ background: "var(--t-bg-base)" }}>
        <header className="shrink-0 flex items-center gap-2 px-2 h-12 border-b" style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}>
          <button data-mobile-back onClick={onBack} className="p-2 text-(--t-text-primary)">
            <Icon icon="lucide:arrow-left" width={22} />
          </button>
          <span className="flex flex-col min-w-0 flex-1">
            <span className="text-base font-semibold text-(--t-text-primary) leading-tight truncate">{t("title")}</span>
            {session?.connectionName && (
              <span className="text-[11px] text-(--t-text-dim) leading-tight truncate">{session.connectionName}</span>
            )}
          </span>
        </header>

        {!ssh || !session ? (
          <div className="flex flex-1 items-center justify-center px-8 text-center">
            <p className="max-w-[260px] text-sm leading-5 text-(--t-text-muted)">
              {t("sshOnly")}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="px-3 py-3 space-y-3">
              <MobileMetricCard
                label={t("cpu")}
                value={snap ? `${snap.cpu_percent.toFixed(1)}%` : "—"}
                color="#ef4444"
                history={cpuH}
              />
              <MobileMetricCard
                label={t("memory")}
                value={snap ? `${fmtMem(snap.mem_used_kb)} / ${fmtMem(snap.mem_total_kb)}` : "—"}
                color="#22c55e"
                history={memH}
              />
              <MobileMetricCard
                label={t("netRx")}
                value={fmtBytes(snap?.net_rx_bytes_per_sec ?? 0)}
                color="#3b82f6"
                history={rxH}
              />
              <MobileMetricCard
                label={t("netTx")}
                value={fmtBytes(snap?.net_tx_bytes_per_sec ?? 0)}
                color="#f59e0b"
                history={txH}
              />
            </div>

            {(disksLoading || disks.length > 0) && (
              <DiskSection disks={disks} loading={disksLoading} />
            )}
            <SystemInfoSection service={service} session={session} defaultExpanded />
          </div>
        )}
      </div>
    );
  };
}
