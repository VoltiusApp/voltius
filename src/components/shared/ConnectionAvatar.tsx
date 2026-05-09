import { Icon } from "@iconify/react";
import type { Connection } from "@/types";
import { getConnectionIcon, getConnectionIconColor } from "@/utils/icons";

interface Props {
  connection: Connection;
  size: number;
}

export function ConnectionAvatar({ connection, size }: Props) {
  const isSerial = connection.connection_type === "serial" || !!connection.serial_port;
  const displayIcon = !isSerial ? (connection.icon || connection.distro) : null;
  const iconName = displayIcon ? getConnectionIcon(displayIcon) : null;
  const iconBg = displayIcon ? getConnectionIconColor(displayIcon) : null;
  const iconSize = Math.round(size * 0.5);

  return (
    <div
      className="flex items-center justify-center shrink-0 select-none text-white"
      style={{ width: `${size / 15}rem`, height: `${size / 15}rem`, borderRadius: `${Math.round(size * 0.2)}px`, background: isSerial ? "var(--t-accent-muted, var(--t-bg-card-avatar))" : (iconBg ?? "var(--t-bg-card-avatar)") }}
    >
      <Icon icon={isSerial ? "lucide:ethernet-port" : (iconName ?? "lucide:server")} width={iconSize} />
    </div>
  );
}
