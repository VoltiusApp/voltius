import type { CSSProperties } from "react";
import { Icon } from "@iconify/react";
import { StatusDot } from "@/components/shared/StatusDot";
import { useConnectionStore } from "@/stores/connectionStore";
import { getConnectionIcon, getConnectionIconColor } from "@/utils/icons";
import type { NotificationSource, ToastHost } from "@/stores/notificationStore";
import { severityTone } from "./severity";

interface Origin {
  source: NotificationSource;
  host?: ToastHost;
}

const TILE = "flex items-center justify-center size-[18px] rounded-[5px] shrink-0";
const NEUTRAL = { background: "var(--t-bg-elevated)", color: "var(--t-text-secondary)" };

function useTile({ source, host }: Origin): { icon: string; style: CSSProperties } | null {
  const connection = useConnectionStore((s) => (host ? s.connections.find((c) => c.id === host.connectionId) : undefined));
  if (host) {
    const key = connection?.icon || connection?.distro;
    return key
      ? { icon: getConnectionIcon(key), style: { background: getConnectionIconColor(key), color: "#fff" } }
      : { icon: "lucide:server", style: NEUTRAL };
  }
  if (source.kind === "plugin") return { icon: source.icon ?? "lucide:puzzle", style: NEUTRAL };
  return null;
}

/** The host or plugin a notification comes from, severity pinned to its corner; the app's own get a bare dot. */
export function NotificationBadge({ source, host, severity, busy = false, halo }: Origin & {
  severity?: string;
  busy?: boolean;
  /** Surface colour behind the badge, so the severity dot is cut out of it. */
  halo: string;
}) {
  const tile = useTile({ source, host });
  if (!tile && !busy) {
    return (
      <span className={TILE}>
        {severity && <StatusDot tone={severityTone(severity)} size="sm" />}
      </span>
    );
  }
  return (
    <span className="relative inline-flex shrink-0">
      <span className={TILE} style={tile?.style ?? NEUTRAL}>
        <Icon icon={busy || !tile ? "lucide:loader-circle" : tile.icon} width={11} className={busy ? "animate-spin" : undefined} />
      </span>
      {severity && !busy && (
        <span className="absolute -right-[3px] -bottom-[3px] inline-flex">
          <StatusDot tone={severityTone(severity)} size="sm" halo={halo} />
        </span>
      )}
    </span>
  );
}

/** The host or plugin name beside a notification; the app's own notifications have none. */
export function NotificationSourceLabel({ source, host, className = "" }: Origin & { className?: string }) {
  const name = host?.name ?? (source.kind === "plugin" ? source.name : null);
  if (!name) return null;
  return (
    <span
      className={`truncate text-[11.5px] text-(--t-text-dim) ${host ? "font-mono" : ""} ${className}`}
      title={name}
    >
      {name}
    </span>
  );
}
