import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { autoRefreshIntervalSetting } from "@/stores/sftpSettingsStore";
import { usePolicyRange } from "@/stores/policyStore";
import { Setting } from "@/components/settings/Setting";
import { SettingRow, SettingsGroup } from "./shared";
import { useIsAndroid, useIsIOS } from "@/utils/platform";
import { downloadDirGet, downloadDirPick, type DownloadDirInfo } from "@/services/downloads";

export default function SFTPSection() {
  const { t } = useTranslation();
  const intervalRange = usePolicyRange(autoRefreshIntervalSetting.key);

  const isAndroid = useIsAndroid();
  const isIOS = useIsIOS();
  const [downloadDir, setDownloadDir] = useState<DownloadDirInfo | null>(null);
  useEffect(() => {
    if (isAndroid || isIOS) void downloadDirGet().then(setDownloadDir).catch(() => {});
  }, [isAndroid, isIOS]);
  const changeDownloadDir = async () => {
    const picked = await downloadDirPick();
    if (picked) setDownloadDir(picked);
  };

  return (
    <div className="p-6 space-y-6">
      {(isAndroid || isIOS) && (
        <SettingsGroup title={t("settings.sftp.downloads.title")}>
          <SettingRow
            title={t("settings.sftp.downloads.folderLabel")}
            desc={downloadDir?.displayName ?? downloadDir?.uri ?? t("settings.sftp.downloads.notSet")}
            truncateDesc
          >
            {isAndroid && <button
              onClick={() => void changeDownloadDir()}
              data-row-control
              className="shrink-0 h-10 px-3 -mr-2 rounded-full text-sm font-medium text-(--t-accent)"
            >
              {t("settings.sftp.downloads.changeFolder")}
            </button>}
          </SettingRow>
        </SettingsGroup>
      )}

      <SettingsGroup title={t("settings.sftp.transfers.title")}>
        <Setting id="toggles.sftp-tar" />
      </SettingsGroup>
      <SettingsGroup title={t("settings.sftp.filePanel.title")} divided>
        <Setting id="toggles.sftp-autorefresh" />
        <Setting id="sftp.autoRefreshIntervalMs" desc={intervalRange ? null : undefined} />
      </SettingsGroup>

      <SettingsGroup title={t("settings.sftp.editor.title")}>
        <Setting id="sftp.editorAutoSave" />
      </SettingsGroup>
    </div>
  );
}
