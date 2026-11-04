import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import type { Connection } from "@/types";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { StatusDot } from "@/components/shared/StatusDot";
import { pingStatusMotion, pingStatusTone } from "@/utils/statusTone";
import { useConnectionStore } from "@/stores/connectionStore";
import { useHostPingStore } from "@/stores/hostPingStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";
import { useTeamStore } from "@/stores/teamStore";
import { useCanConnect } from "@/hooks/useCanConnect";

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
  const canConnect = useCanConnect(connection);
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
  const name = displayName(connection);

  return (
    <div className="group relative shrink-0" style={{ width: "7.5rem" }}>
      <button
        type="button"
        disabled={!canConnect}
        className="surface-glass surface-glass-interactive flex flex-col items-center gap-2 w-full px-1 py-3 rounded-xl cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        title={canConnect ? undefined : t("common.error.connectNotAllowed")}
        onClick={() => onConnect(connection)}
      >
        <span className="relative">
          <ConnectionAvatar connection={connection} size={36} />
          {showPingDot && (
            <StatusDot
              tone={pingStatusTone(pingStatus)}
              motion={pingStatusMotion(pingStatus)}
              hollow={pingStatus === "knock"}
              halo="var(--t-bg-elevated)"
              corner
              label={t(`home.hostCard.status.${pingStatus ?? "unknown"}`)}
            />
          )}
        </span>
        <span className="text-xs font-medium text-center w-full truncate text-(--t-text-primary)">
          {name}
        </span>
        <span className="text-[10px] w-full truncate text-(--t-text-dim)">
          {isSerial ? (connection.serial_baud ? t("home.hostCard.baud", { rate: connection.serial_baud }) : "") : connection.host}
        </span>
      </button>
      <button
        type="button"
        className={`absolute top-1.5 right-1.5 transition-opacity p-0.5 rounded-sm ${pinAlwaysVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}
        style={{ color: pinColor }}
        onClick={handlePinClick}
        title={isPinned ? t("home.hostCard.unpin") : t("home.hostCard.pin")}
        aria-label={isPinned ? t("home.hostCard.unpinHost", { name }) : t("home.hostCard.pinHost", { name })}
      >
        <Icon icon={pinIcon} width={11} />
      </button>
    </div>
  );
}
