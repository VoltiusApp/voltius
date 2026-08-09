import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_AUTO_REFRESH_INTERVAL_MS, useSftpSettingsStore } from "@/stores/sftpSettingsStore";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { Toggle } from "@/components/shared/Toggle";
import { SettingRow, SettingsGroup } from "./shared";
import { useIsAndroid } from "@/utils/platform";
import { downloadDirGet, downloadDirPick, type DownloadDirInfo } from "@/services/downloads";

export default function SFTPSection() {
  const { t } = useTranslation();
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useToggle("sftp-autorefresh");
  const [tarTransferEnabled, setTarTransferEnabled] = useToggle("sftp-tar");
  const autoRefreshIntervalMs = useSftpSettingsStore((s) => s.autoRefreshIntervalMs);
  const setAutoRefreshIntervalMs = useSftpSettingsStore((s) => s.setAutoRefreshIntervalMs);
  const editorAutoSave = useSftpSettingsStore((s) => s.editorAutoSave);
  const setEditorAutoSave = useSftpSettingsStore((s) => s.setEditorAutoSave);

  const intervalSeconds = autoRefreshIntervalMs / 1000;

  const isAndroid = useIsAndroid();
  const [downloadDir, setDownloadDir] = useState<DownloadDirInfo | null>(null);
  useEffect(() => {
    if (isAndroid) void downloadDirGet().then(setDownloadDir);
  }, [isAndroid]);
  const changeDownloadDir = async () => {
    const picked = await downloadDirPick();
    if (picked) setDownloadDir(picked);
  };

  const handleIntervalChange = (raw: string) => {
    const val = parseFloat(raw);
    if (!Number.isFinite(val) || val < 0.5) return;
    setAutoRefreshIntervalMs(Math.round(val * 1000));
  };

  return (
    <div className="p-6 max-w-lg space-y-6">
      {isAndroid && (
        <SettingsGroup title={t("settings.sftp.downloads.title")}>
          <SettingRow
            title={t("settings.sftp.downloads.folderLabel")}
            desc={downloadDir?.displayName ?? downloadDir?.uri ?? t("settings.sftp.downloads.notSet")}
            truncateDesc
          >
            <button
              onClick={() => void changeDownloadDir()}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) active:bg-(--t-bg-card-hover)"
            >
              {t("settings.sftp.downloads.changeFolder")}
            </button>
          </SettingRow>
        </SettingsGroup>
      )}

      <SettingsGroup title={t("settings.sftp.transfers.title")}>
        <SettingRow
          title={t("settings.sftp.transfers.tarAcceleration.title")}
          desc={
            <>
              {t("settings.sftp.transfers.tarAcceleration.descPre")}
              <code className="font-mono">tar</code>
              {t("settings.sftp.transfers.tarAcceleration.descPost")}
            </>
          }
          dirty={tarTransferEnabled !== TOGGLE_DEFS["sftp-tar"].default}
          onReset={() => setTarTransferEnabled(TOGGLE_DEFS["sftp-tar"].default)}
        >
          <Toggle checked={tarTransferEnabled} onChange={setTarTransferEnabled} />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.sftp.filePanel.title")} divided>
        <SettingRow
          title={t("settings.sftp.filePanel.autoRefresh.title")}
          desc={t("settings.sftp.filePanel.autoRefresh.desc")}
          dirty={autoRefreshEnabled !== TOGGLE_DEFS["sftp-autorefresh"].default}
          onReset={() => setAutoRefreshEnabled(TOGGLE_DEFS["sftp-autorefresh"].default)}
        >
          <Toggle checked={autoRefreshEnabled} onChange={setAutoRefreshEnabled} />
        </SettingRow>
        <SettingRow
          title={t("settings.sftp.filePanel.refreshInterval.title")}
          desc={t("settings.sftp.filePanel.refreshInterval.desc")}
          dimmed={!autoRefreshEnabled}
          dirty={autoRefreshIntervalMs !== DEFAULT_AUTO_REFRESH_INTERVAL_MS}
          onReset={() => setAutoRefreshIntervalMs(DEFAULT_AUTO_REFRESH_INTERVAL_MS)}
        >
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={intervalSeconds}
            disabled={!autoRefreshEnabled}
            onChange={(e) => handleIntervalChange(e.target.value)}
            className="form-input w-20 px-2 py-1 rounded-lg text-sm text-right outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
            style={{ opacity: autoRefreshEnabled ? 1 : 0.45 }}
          />
          <span className="text-xs text-(--t-text-dim)">{t("settings.sftp.filePanel.refreshInterval.unit")}</span>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.sftp.editor.title")}>
        <SettingRow
          title={t("settings.sftp.editor.autoSave.title")}
          desc={t("settings.sftp.editor.autoSave.desc")}
          dirty={editorAutoSave}
          onReset={() => setEditorAutoSave(false)}
        >
          <Toggle checked={editorAutoSave} onChange={setEditorAutoSave} />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
