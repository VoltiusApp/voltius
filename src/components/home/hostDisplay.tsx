import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import type { Connection } from "@/types";
import { StatusDot } from "@/components/shared/StatusDot";
import { pingStatusMotion, pingStatusTone } from "@/utils/statusTone";
import { useHostPingStore } from "@/stores/hostPingStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";

export function useConnectFromHome(): (conn: Connection) => void {
  const connect = useSessionStore((s) => s.connect);
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  return (conn) => {
    connect(conn.id).catch(() => {});
    setActiveNav("terminal");
  };
}

export function isSerialConn(c: Connection): boolean {
  return c.connection_type === "serial" || !!c.serial_port;
}

export function hostDisplayName(c: Connection): string {
  if (c.name?.trim()) return c.name.trim();
  if (isSerialConn(c)) return c.serial_port ?? i18n.t("home.serialFallback");
  return `${c.username}@${c.host}`;
}

export function hostAddress(c: Connection): string {
  if (!isSerialConn(c)) return c.host;
  return c.serial_baud ? i18n.t("home.hostCard.baud", { rate: c.serial_baud }) : "";
}

export function HostPingDot({ connection, size = "md" }: { connection: Connection; size?: "sm" | "md" }) {
  const { t } = useTranslation();
  const [pingEnabled] = useToggle("reachability");
  const status = useHostPingStore((s) => s.statuses[connection.id]);
  if (!pingEnabled || connection.ping_disabled || isSerialConn(connection)) return null;
  return (
    <StatusDot
      tone={pingStatusTone(status)}
      motion={pingStatusMotion(status)}
      hollow={status === "knock"}
      halo="var(--t-bg-elevated)"
      size={size}
      corner
      label={t(`home.hostCard.status.${status ?? "unknown"}`)}
    />
  );
}
