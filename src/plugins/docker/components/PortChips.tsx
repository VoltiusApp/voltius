import { useState } from "react";
import { Icon } from "@iconify/react";
import { getDockerApi } from "../runtime";
import { classifyPorts, actionFor, type ClassifiedPort } from "../ports";
import type { PortMapping } from "../types";

interface Props {
  ports: PortMapping[];
  sessionId: string;
  isRemote: boolean;
  limit?: number;
  size?: "sm" | "md";
  onOverflow?: () => void;
}

const SIZE = {
  sm: "text-[10px] px-1 py-0 gap-0.5",
  md: "text-[11px] px-2 py-1 gap-1",
} as const;

export function PortChips({ ports, sessionId, isRemote, limit, size = "sm", onOverflow }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (ports.length === 0) return null;

  const all = classifyPorts(ports);
  const shown = limit ? all.slice(0, limit) : all;
  const hidden = all.length - shown.length;

  const key = (c: ClassifiedPort) => `${c.port.host_port ?? "x"}:${c.port.container_port}/${c.port.protocol}`;

  const open = async (c: ClassifiedPort) => {
    const action = actionFor(c.kind);
    if (!action || c.port.host_port == null) return;
    const k = key(c);
    setBusy(k);
    try {
      await getDockerApi()?.ports.reach({
        sessionId,
        isRemote,
        hostPort: c.port.host_port,
        hostIp: c.port.host_ip,
        scheme: c.scheme,
        action,
      });
      setDone(k);
      setTimeout(() => setDone((v) => (v === k ? null : v)), 1200);
    } catch (e) {
      getDockerApi()?.notifications.toast(`Port ${c.port.host_port}: ${e}`, { severity: "error" });
    } finally {
      setBusy((v) => (v === k ? null : v));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1 min-w-0">
      {shown.map((c) => {
        const k = key(c);
        const inert = c.kind === "inert";
        return (
          <button
            key={k}
            disabled={inert || busy === k}
            title={inert ? (c.inertReason ?? "") : `${c.full} — ${c.kind === "http" ? "open in browser" : "forward and copy address"}`}
            onClick={(e) => { e.stopPropagation(); void open(c); }}
            className={`flex items-center rounded-sm font-mono shrink-0 ${SIZE[size]} ${
              inert
                ? "bg-(--t-bg-card-hover) text-(--t-text-muted) opacity-50 cursor-default"
                : "bg-(--t-bg-card-hover) text-(--t-text) hover:text-(--t-accent) hover:bg-(--t-bg-elevated)"
            }`}
          >
            <span className="truncate">{limit ? c.short : c.full}</span>
            {!inert && (
              <Icon
                icon={done === k ? "lucide:check" : busy === k ? "lucide:loader-circle" : c.kind === "http" ? "lucide:globe" : "lucide:plug"}
                width={size === "md" ? 12 : 10}
                className={busy === k ? "animate-spin" : done === k ? "text-(--t-status-connected)" : ""}
              />
            )}
          </button>
        );
      })}
      {hidden > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onOverflow?.(); }}
          title="Show all ports"
          className={`rounded-sm font-mono shrink-0 bg-(--t-bg-card-hover) text-(--t-text-muted) hover:text-(--t-text) ${SIZE[size]}`}
        >
          +{hidden}
        </button>
      )}
    </div>
  );
}
