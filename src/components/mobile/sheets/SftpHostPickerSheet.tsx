import { useTranslation } from "react-i18next";
import { MyDevicesGroup, myDevicesVisible } from "@/components/shared/MyDevicesGroup";
import { useMyDevices } from "@/services/myDevices";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import type { SftpPaneTarget } from "../panels/sftpSelectionCore";
import HostPickerSheet from "./HostPickerSheet";

export default function SftpHostPickerSheet({
  excludeId, onPick, onClose,
}: { excludeId?: string; onPick: (target: SftpPaneTarget) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const devices = useMyDevices();
  const blocked = useLanSyncStore((s) => s.status === "blocked");
  const deviceSlot = (query: string) => ({
    node: <MyDevicesGroup density="touch" query={query} onPick={(device) => onPick({ kind: "device", device })} />,
    shown: myDevicesVisible(devices, query, blocked),
  });
  return (
    <HostPickerSheet title={t("mobile.sftp.chooseHost")} attr="sftp-host" emptyLabel={t("mobile.sheets.sftpHostPicker.noSshHosts")}
      sshOnly excludeId={excludeId} onClose={onClose} devices={deviceSlot}
      onPick={(id) => onPick({ kind: "connection", id })} />
  );
}
