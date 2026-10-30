import type { TFunction } from "i18next";
import { routeLabel } from "@/services/myDevices";
import { DEVICE_TILE_BASE, deviceIcon, getConnectionIcon, getConnectionIconColor } from "@/utils/icons";
import type { HostChoice } from "./SFTPTypes";

const AVATAR = "var(--t-bg-card-avatar)";

export function hostPresentation(h: HostChoice, t: TFunction): { icon: string; name: string; subtitle?: string; base: string } {
  if (h.kind === "local") {
    const brand = h.wslDistro?.split(/[-_ ]/)[0];
    return {
      icon: brand ? getConnectionIcon(brand) : "lucide:monitor",
      name: h.wslDistro ?? t("fileTransfer.common.localMachine"),
      base: (brand && getConnectionIconColor(brand)) || AVATAR,
    };
  }
  if (h.kind === "device") {
    const d = h.device;
    return { icon: deviceIcon(d.platform), name: d.name, subtitle: d.route ? routeLabel(t, d.route) : undefined, base: DEVICE_TILE_BASE };
  }
  const c = h.connection;
  const brand = c.icon || c.distro;
  return {
    icon: (brand ? getConnectionIcon(brand) : null) ?? "lucide:server",
    name: c.name?.trim() || `${c.username}@${c.host}`,
    subtitle: `${c.username}@${c.host}:${c.port}`,
    base: (brand && getConnectionIconColor(brand)) || AVATAR,
  };
}
