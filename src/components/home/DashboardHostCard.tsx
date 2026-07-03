import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import type { Connection } from "@/types";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { useConnectionStore } from "@/stores/connectionStore";
import { useHostPingStore } from "@/stores/hostPingStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";
import { useTeamStore } from "@/stores/teamStore";

function isSerialConn(c: Connection): boolean {
  return c.connection_type === "serial" || !!c.serial_port;
}

function displayName(c: Connection): string {
  if (c.name?.trim()) return c.name.trim();
  if (isSerialConn(c)) return c.serial_port ?? i18n.t("home.serialFallback");
  return `${c.username}@${c.host}`;
}

interface Props {
  connection: Connection;
  onConnect: (conn: Connection) => void;
}

export function DashboardHostCard({ connection, onConnect }: Props) {
  const { t } = useTranslation();
  const pinConnection = useConnectionStore((s) => s.pinConnection);
  const isPinned = useEffectivePinned(connection, "connection");
  const pinSource = useEffectivePinSource(connection, "connection");
  const isTeamVault = useTeamStore((s) => s.teams.some((t) => t.id === connection.vault_id));
  const [pingEnabled] = useToggle("reachability");
  const pingStatus = useHostPingStore((s) => s.statuses[connection.id]);
  const isSerial = isSerialConn(connection);
  const showPingDot = pingEnabled && !connection.ping_disabled && !isSerial;
  const pinAlwaysVisible = pinSource !== "none" && pinSource !== "team-hidden";
  const handlePinClick = () => {
    if (!isTeamVault) {
      pinConnection(connection.id, !isPinned).catch(() => {});
    } else {
      pinConnection(connection.id, nextPersonalPinValue(pinSource)).catch(() => {});
    }
  };
  const pinIcon = pinSource === "team-hidden" ? "lucide:pin-off" : "lucide:pin";
  const pinColor =
    pinSource === "personal" || pinSource === "team+personal"
      ? "var(--t-accent)"
      : pinSource === "team"
      ? "var(--t-text-secondary)"
      : "var(--t-text-dim)";

  return (
    <div
      className="surface-glass group relative flex flex-col items-center gap-2 p-3 rounded-xl cursor-pointer transition-all shrink-0"
      style={{ width: "7.5rem" }}
      onClick={() => onConnect(connection)}
    >
      <button
        className={`absolute top-1.5 right-1.5 transition-opacity p-0.5 rounded-sm ${pinAlwaysVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        style={{ color: pinColor }}
        onClick={(e) => {
          e.stopPropagation();
          handlePinClick();
        }}
        title={isPinned ? t("home.hostCard.unpin") : t("home.hostCard.pin")}
      >
        <Icon icon={pinIcon} width={11} />
      </button>
      <div className="relative">
        <ConnectionAvatar connection={connection} size={36} />
        {showPingDot && (
          <span className="absolute bottom-0 right-0">
            {pingStatus === "up" && (
              <span
                className="absolute inset-0 rounded-full animate-ping-slow"
                style={{ background: "var(--t-status-connected)" }}
              />
            )}
            <span
              className="relative block rounded-full border-2 border-(--t-bg-elevated)"
              style={{
                width: 10,
                height: 10,
                background: pingStatus === "up"
                  ? "var(--t-status-connected)"
                  : pingStatus === "down"
                  ? "var(--t-status-error)"
                  : "var(--t-text-dim)",
              }}
            />
          </span>
        )}
      </div>
      <span
        className="text-xs font-medium text-center w-full truncate"
        style={{ color: "var(--t-text-primary)" }}
      >
        {displayName(connection)}
      </span>
      <span className="text-[10px]" style={{ color: "var(--t-text-dim)" }}>
        {isSerial ? (connection.serial_baud ? t("home.hostCard.baud", { rate: connection.serial_baud }) : "") : connection.host}
      </span>
    </div>
  );
}
