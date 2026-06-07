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

  // Glossy macOS app-icon tile derived from the distro's own brand color:
  // light top → tint → dark bottom, with the shared ring + highlight and a
  // soft colored glow. color-mix is inlined (WebKitGTK-safe), never stored.
  const base = isSerial ? "var(--t-accent-muted, var(--t-bg-card-avatar))" : (iconBg ?? "var(--t-bg-card-avatar)");

  return (
    <div
      className="flex items-center justify-center shrink-0 select-none text-white"
      style={{
        width: `${size / 15}rem`,
        height: `${size / 15}rem`,
        borderRadius: `${Math.round(size * 0.2)}px`,
        background: `linear-gradient(145deg, color-mix(in srgb, ${base} 78%, #ffffff 22%) 0%, ${base} 55%, color-mix(in srgb, ${base} 84%, #000000 16%) 100%)`,
        boxShadow: `var(--t-ring), 0 4px 10px -5px color-mix(in srgb, ${base} 60%, transparent), var(--t-highlight)`,
      }}
    >
      <Icon icon={isSerial ? "lucide:ethernet-port" : (iconName ?? "lucide:server")} width={iconSize} />
    </div>
  );
}
