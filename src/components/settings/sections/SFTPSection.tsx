import { useEffect, useState } from "react";
import { DEFAULT_AUTO_REFRESH_INTERVAL_MS, useSftpSettingsStore } from "@/stores/sftpSettingsStore";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { Toggle } from "@/components/shared/Toggle";
import { DirtyDot, ResetButton } from "./shared";
import { useIsAndroid } from "@/utils/platform";
import { downloadDirGet, downloadDirPick, type DownloadDirInfo } from "@/services/downloads";

export default function SFTPSection() {
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
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
              Downloads
            </h3>
            <div className="rounded-lg bg-(--t-bg-elevated) border border-(--t-border)">
              <div className="flex items-center justify-between px-4 py-3 gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-(--t-text-primary)">Download folder</p>
                  <p className="text-xs mt-0.5 text-(--t-text-dim) truncate">
                    {downloadDir?.displayName ?? downloadDir?.uri ?? "Not set — chosen on first download"}
                  </p>
                </div>
                <button
                  onClick={() => void changeDownloadDir()}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) active:bg-(--t-bg-card-hover)"
                >
                  Change folder
                </button>
              </div>
            </div>
          </div>
        )}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          Transfers
        </h3>

        <div className="rounded-lg bg-(--t-bg-elevated) border border-(--t-border)">
          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-(--t-text-primary)">Tar acceleration</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">
                Pack directories into a single tar.gz before transfer — much faster for many small files.
                Requires <code className="font-mono">tar</code> on both sides.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {tarTransferEnabled !== TOGGLE_DEFS["sftp-tar"].default && (
                <ResetButton onReset={() => setTarTransferEnabled(TOGGLE_DEFS["sftp-tar"].default)} />
              )}
              {tarTransferEnabled !== TOGGLE_DEFS["sftp-tar"].default && <DirtyDot />}
              <Toggle checked={tarTransferEnabled} onChange={setTarTransferEnabled} />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          File Panel
        </h3>

        <div
          className="rounded-lg divide-y bg-(--t-bg-elevated) border border-(--t-border)"
        >
          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-(--t-text-primary)">Auto-refresh</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">
                Silently re-fetches directory contents in the background
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {autoRefreshEnabled !== TOGGLE_DEFS["sftp-autorefresh"].default && (
                <ResetButton onReset={() => setAutoRefreshEnabled(TOGGLE_DEFS["sftp-autorefresh"].default)} />
              )}
              {autoRefreshEnabled !== TOGGLE_DEFS["sftp-autorefresh"].default && <DirtyDot />}
              <Toggle checked={autoRefreshEnabled} onChange={setAutoRefreshEnabled} />
            </div>
          </div>

          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-(--t-text-primary)" style={{ opacity: autoRefreshEnabled ? 1 : 0.45 }}>
                Refresh interval
              </p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)" style={{ opacity: autoRefreshEnabled ? 1 : 0.45 }}>
                Minimum 0.5 s
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {autoRefreshIntervalMs !== DEFAULT_AUTO_REFRESH_INTERVAL_MS && (
                <ResetButton onReset={() => setAutoRefreshIntervalMs(DEFAULT_AUTO_REFRESH_INTERVAL_MS)} />
              )}
              {autoRefreshIntervalMs !== DEFAULT_AUTO_REFRESH_INTERVAL_MS && <DirtyDot />}
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
              <span className="text-xs text-(--t-text-dim)">s</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          Editor
        </h3>

        <div className="rounded-lg bg-(--t-bg-elevated) border border-(--t-border)">
          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-(--t-text-primary)">Auto-save</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">
                Automatically save file changes as you type
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {editorAutoSave && (
                <ResetButton onReset={() => setEditorAutoSave(false)} />
              )}
              {editorAutoSave && <DirtyDot />}
              <Toggle checked={editorAutoSave} onChange={setEditorAutoSave} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
