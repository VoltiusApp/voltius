import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { Connection } from "@/types";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { useConnectionStore } from "@/stores/connectionStore";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";
import { useTeamStore } from "@/stores/teamStore";
import { useCanConnect } from "@/hooks/useCanConnect";
import { HostPingDot, hostAddress, hostDisplayName } from "./hostDisplay";

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
  const name = hostDisplayName(connection);

  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        disabled={!canConnect}
        className="surface-glass surface-glass-interactive flex flex-col items-center gap-2 w-full px-2 py-3 rounded-xl cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        title={canConnect ? undefined : t("common.error.connectNotAllowed")}
        onClick={() => onConnect(connection)}
      >
        <span className="relative">
          <ConnectionAvatar connection={connection} size={36} />
          <HostPingDot connection={connection} />
        </span>
        <span className="text-sm font-medium text-center w-full truncate text-(--t-text-primary)">
          {name}
        </span>
        <span className="font-mono text-xs w-full truncate text-(--t-text-dim)" title={hostAddress(connection)}>
          {hostAddress(connection)}
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
