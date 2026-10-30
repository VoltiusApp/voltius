import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Icon } from "@iconify/react";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { StatusDot } from "@/components/shared/StatusDot";
import { SyncInlineAction } from "@/components/shared/SyncSectionParts";
import { blockedFix } from "@/services/lanBlockedFix";
import { routeLabel, useMyDevices, type MyDevice, type MyDeviceState } from "@/services/myDevices";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import { DEVICE_TILE_BASE, deviceIcon } from "@/utils/icons";
import { formatRelative } from "@/utils/localeFormat";
import { usePlatform } from "@/utils/platform";
import { searchMatcher } from "@/utils/search";
import { HOST_PICKER_DENSITY, Heading, type HostPickerDensity } from "./HostPickerTree";
import { HostRow } from "./HostRow";

const TRAILING: Record<MyDeviceState, ReactNode> = {
  ready: <StatusDot tone="connected" size="sm" />,
  off: <Icon icon="lucide:lock" width={13} className="shrink-0 text-(--t-text-dim)" />,
  offline: <StatusDot tone="idle" size="sm" hollow />,
};

function subtitle(t: TFunction, d: MyDevice): string {
  if (d.state === "off") return t("fileTransfer.myDevices.fileAccessOff");
  if (d.state === "offline") {
    return d.lastSeen ? t("fileTransfer.myDevices.offlineSeen", { ago: formatRelative(d.lastSeen) }) : t("fileTransfer.myDevices.offline");
  }
  return routeLabel(t, d.route ?? "lan");
}

function shownDevices(devices: MyDevice[], query: string, blocked: boolean): MyDevice[] | null {
  const matches = searchMatcher(query);
  const shown = devices.filter((d) => matches(d.name));
  return blocked || shown.length > 0 ? shown : null;
}

export function myDevicesVisible(devices: MyDevice[], query: string, blocked: boolean): boolean {
  return shownDevices(devices, query, blocked) !== null;
}

export function MyDevicesGroup({ density, onPick, selectedDeviceId, query = "" }: {
  density: HostPickerDensity;
  onPick: (device: MyDevice) => void;
  selectedDeviceId?: string;
  query?: string;
}) {
  const { t } = useTranslation();
  const devices = useMyDevices();
  const blocked = useLanSyncStore((s) => s.status === "blocked");
  const platform = usePlatform();
  const shown = shownDevices(devices, query, blocked);
  const fix = blocked ? blockedFix(t, platform) : null;
  if (!shown) return null;

  return (
    <div data-my-devices>
      <Heading density={density}>{t("fileTransfer.myDevices.title")}</Heading>
      {fix ? (
        <div className={`flex items-start ${HOST_PICKER_DENSITY[density].row} text-xs`} style={{ color: fix.color }}>
          <Icon icon={fix.icon} width={13} className="shrink-0 mt-0.5" />
          <span className="leading-snug">
            {fix.label}
            {fix.action && <> <SyncInlineAction onClick={fix.action.onTap} label={fix.action.label} /></>}
          </span>
        </div>
      ) : shown.map((d) => {
        const ready = d.state === "ready";
        return (
          <HostRow
            key={d.deviceId}
            density={density}
            avatar={
              <AvatarTile
                base={ready ? DEVICE_TILE_BASE : null}
                icon={deviceIcon(d.platform)}
                iconSize={14}
                className={`w-[1.867rem] h-[1.867rem] rounded-lg ${ready ? "text-(--t-text-bright)" : "text-(--t-text-dim)"}`}
              />
            }
            name={d.name}
            sub={subtitle(t, d)}
            isSelected={d.deviceId === selectedDeviceId}
            disabled={!ready}
            trailing={TRAILING[d.state]}
            onClick={() => onPick(d)}
          />
        );
      })}
    </div>
  );
}
