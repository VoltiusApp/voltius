import type { Connection } from "@/types";
import { getConnectionIcon, getConnectionIconColor } from "@/utils/icons";
import { AvatarTile } from "@/components/shared/AvatarTile";

interface Props {
  connection: Connection;
  size: number;
}

export function ConnectionAvatar({ connection, size }: Props) {
  const isSerial = connection.connection_type === "serial" || !!connection.serial_port;
  const displayIcon = !isSerial ? (connection.icon || connection.distro) : null;
  const iconName = displayIcon ? getConnectionIcon(displayIcon) : null;
  const iconBg = displayIcon ? getConnectionIconColor(displayIcon) : null;

  const base = isSerial ? "var(--t-accent-muted, var(--t-bg-card-avatar))" : (iconBg ?? "var(--t-bg-card-avatar)");

  return (
    <AvatarTile
      base={base}
      icon={isSerial ? "lucide:ethernet-port" : (iconName ?? "lucide:server")}
      size={size}
      radius={Math.round(size * 0.2)}
      className="text-white"
    />
  );
}
