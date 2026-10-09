import type { TFunction } from "i18next";
import type { TunnelType } from "@/types";

const TUNNEL_TYPE_ICONS: Record<TunnelType, string> = {
  local: "lucide:log-in",
  remote: "lucide:log-out",
  dynamic: "lucide:waypoints",
};

export interface TunnelTypeChoice {
  type: TunnelType;
  label: string;
  icon: string;
}

export function tunnelTypeChoices(t: TFunction): TunnelTypeChoice[] {
  return (Object.keys(TUNNEL_TYPE_ICONS) as TunnelType[]).map((type) => ({
    type,
    label: t(`portForwarding.ruleForm.tunnelTypes.${type}.title`),
    icon: TUNNEL_TYPE_ICONS[type],
  }));
}
