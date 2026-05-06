import { Icon } from "@iconify/react";
import type { Connection } from "@/types";
import { getDistroIcon, getDistroColor } from "@/utils/icons";

interface Props {
  connection: Connection;
  size: number;
}

export function ConnectionAvatar({ connection, size }: Props) {
  const isSerial = connection.connection_type === "serial" || !!connection.serial_port;
  const distroIcon = !isSerial && connection.distro ? getDistroIcon(connection.distro) : null;
  const distroBg = !isSerial && connection.distro ? getDistroColor(connection.distro) : null;
  const iconSize = Math.round(size * 0.5);

  return (
    <div
      className="flex items-center justify-center shrink-0 select-none text-white"
      style={{ width: `${size / 15}rem`, height: `${size / 15}rem`, borderRadius: `${Math.round(size * 0.2)}px`, background: isSerial ? "var(--t-accent-muted, var(--t-bg-card-avatar))" : (distroBg ?? "var(--t-bg-card-avatar)") }}
    >
      <Icon icon={isSerial ? "lucide:ethernet-port" : (distroIcon ?? "lucide:server")} width={iconSize} />
    </div>
  );
}
