import { Icon } from "@iconify/react";
import type { Connection } from "@/types";
import { getDistroIcon, getDistroColor } from "@/utils/icons";

interface Props {
  connection: Connection;
  size: number;
}

export function ConnectionAvatar({ connection, size }: Props) {
  const distroIcon = connection.distro ? getDistroIcon(connection.distro) : null;
  const distroBg = connection.distro ? getDistroColor(connection.distro) : null;
  const iconSize = Math.round(size * 0.5);

  return (
    <div
      className="rounded-lg flex items-center justify-center shrink-0 select-none text-white"
      style={{ width: `${size / 15}rem`, height: `${size / 15}rem`, background: distroBg ?? "var(--t-bg-card-avatar)" }}
    >
      <Icon icon={distroIcon ?? "lucide:server"} width={iconSize} />
    </div>
  );
}
