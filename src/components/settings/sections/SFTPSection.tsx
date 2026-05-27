import { DEFAULT_AUTO_REFRESH_INTERVAL_MS, useSftpSettingsStore } from "@/stores/sftpSettingsStore";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { Toggle } from "@/components/shared/Toggle";
import { DirtyDot, ResetButton } from "./shared";

export default function SFTPSection() {
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useToggle("sftp-autorefresh");
  const [tarTransferEnabled, setTarTransferEnabled] = useToggle("sftp-tar");
  const autoRefreshIntervalMs = useSftpSettingsStore((s) => s.autoRefreshIntervalMs);
  const setAutoRefreshIntervalMs = useSftpSettingsStore((s) => s.setAutoRefreshIntervalMs);

  const intervalSeconds = autoRefreshIntervalMs / 1000;

  const handleIntervalChange = (raw: string) => {
    const val = parseFloat(raw);
    if (!Number.isFinite(val) || val < 0.5) return;
    setAutoRefreshIntervalMs(Math.round(val * 1000));
  };

  return (
    <div className="p-6 max-w-lg space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          Transfers
        </h3>

        <div className="rounded-lg bg-[var(--t-bg-elevated)] border border-[var(--t-border)]">
          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--t-text-primary)]">Tar acceleration</p>
              <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">
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
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          File Panel
        </h3>

        <div
          className="rounded-lg divide-y bg-[var(--t-bg-elevated)] border border-[var(--t-border)]"
        >
          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--t-text-primary)]">Auto-refresh</p>
              <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">
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
              <p className="text-sm font-medium text-[var(--t-text-primary)]" style={{ opacity: autoRefreshEnabled ? 1 : 0.45 }}>
                Refresh interval
              </p>
              <p className="text-xs mt-0.5 text-[var(--t-text-dim)]" style={{ opacity: autoRefreshEnabled ? 1 : 0.45 }}>
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
                className="w-20 px-2 py-1 rounded-lg text-sm text-right outline-none transition-colors bg-[var(--t-bg-input)] border border-[var(--t-border)] text-[var(--t-text-primary)]"
                style={{ opacity: autoRefreshEnabled ? 1 : 0.45 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--t-accent)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "var(--t-border)"; }}
              />
              <span className="text-xs text-[var(--t-text-dim)]">s</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
