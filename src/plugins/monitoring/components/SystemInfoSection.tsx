import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";
import type { SystemInfo } from "../types";
import type { TerminalSession } from "@/types";

function fmtMem(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(0)} GB`;
  return `${(kb / 1024).toFixed(0)} MB`;
}

function stripCpuFreq(brand: string): string {
  return brand.replace(/@\s*[\d.]+\s*GHz/i, "").trim();
}

function Row({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <Icon icon={icon} width={13} className="text-(--t-text-dim) mt-0.5 shrink-0" />
      <span className="text-[11px] text-(--t-text-muted) w-16 shrink-0">{label}</span>
      <span className="text-[11px] text-(--t-text-primary) leading-snug wrap-break-word min-w-0">{value}</span>
    </div>
  );
}

export function SystemInfoSection({
  session,
  defaultExpanded = false,
}: {
  session: TerminalSession;
  defaultExpanded?: boolean;
}) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    invoke<SystemInfo>("get_connected_system_info", {
      sessionId: session.id,
      sessionType: session.type,
      sessionName: session.connectionName,
    })
      .then((nextInfo) => {
        if (!cancelled) setInfo(nextInfo);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      });

    return () => {
      cancelled = true;
    };
  }, [session.id, session.type, session.connectionName]);

  return (
    <div className="border-t border-(--t-border) shrink-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 transition-colors"
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <div className="flex items-center gap-2">
          <Icon icon="lucide:cpu" width={13} className="text-(--t-text-muted)" />
          <span className="text-[11px] font-medium text-(--t-text-muted) uppercase tracking-wide">
            System Info
          </span>
        </div>
        <Icon
          icon={expanded ? "lucide:chevron-up" : "lucide:chevron-down"}
          width={12}
          className="text-(--t-text-dim)"
        />
      </button>

      {expanded && (
        <div className="px-4 pb-3">
          {!info ? (
            <p className="text-[11px] text-(--t-text-dim) py-1">Loading…</p>
          ) : (
            <>
              {info.cpu_brand && (
                <Row icon="lucide:cpu" label="CPU" value={stripCpuFreq(info.cpu_brand)} />
              )}
              {(info.cpu_cores_physical > 0 || info.cpu_cores_logical > 0) && (
                <Row
                  icon="lucide:layers"
                  label="Cores"
                  value={`${info.cpu_cores_physical}P / ${info.cpu_cores_logical}L`}
                />
              )}
              {info.arch && (
                <Row icon="lucide:cpu" label="Arch" value={info.arch} />
              )}
              {info.mem_total_kb > 0 && (
                <Row icon="lucide:memory-stick" label="RAM" value={fmtMem(info.mem_total_kb)} />
              )}
              {info.gpus.length > 0 && (
                <Row
                  icon="lucide:monitor"
                  label={info.gpus.length > 1 ? "GPUs" : "GPU"}
                  value={info.gpus.join(", ")}
                />
              )}
              {info.host_name && (
                <Row icon="lucide:server" label="Host" value={info.host_name} />
              )}
              {info.os_name && (
                <Row
                  icon="lucide:terminal"
                  label="OS"
                  value={`${info.os_name}${info.os_version ? ` ${info.os_version}` : ""}`}
                />
              )}
              {info.kernel_version && (
                <Row icon="lucide:layers-2" label="Kernel" value={info.kernel_version} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
