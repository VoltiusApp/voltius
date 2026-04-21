import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { getVersion } from "@tauri-apps/api/app";
import {
  getUpdaterState,
  onUpdaterStateChange,
  checkForUpdate,
  installUpdate,
} from "@/services/updater";

export default function AboutSection() {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updater, setUpdater] = useState(getUpdaterState);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"));
    return onUpdaterStateChange(() => setUpdater(getUpdaterState()));
  }, []);

  const busy = updater.status === "checking" || updater.status === "downloading";

  return (
    <div className="p-6 max-w-lg space-y-6">
      {/* App version */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          Version
        </h3>
        <div
          className="rounded-lg px-4 py-3 flex items-center gap-3 bg-[var(--t-bg-elevated)] border border-[var(--t-border)]"
        >
          <Icon icon="lucide:terminal-square" width={16} className="text-[var(--t-accent)] shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--t-text-primary)]">Voltius</p>
            <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">
              {appVersion ? `v${appVersion}` : "Loading…"}
            </p>
          </div>
        </div>
      </div>

      {/* Update */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          Updates
        </h3>
        <div
          className="rounded-lg px-4 py-3 space-y-3 bg-[var(--t-bg-elevated)] border border-[var(--t-border)]"
        >
          {/* Status line */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {updater.status === "checking" && (
                <Icon icon="lucide:loader-2" width={14} className="animate-spin shrink-0 text-[var(--t-accent)]" />
              )}
              {updater.status === "downloading" && (
                <Icon icon="lucide:download" width={14} className="shrink-0 text-[var(--t-accent)]" />
              )}
              {updater.status === "ready" && (
                <Icon icon="lucide:check-circle-2" width={14} className="shrink-0 text-[var(--t-status-connected)]" />
              )}
              {updater.status === "upToDate" && (
                <Icon icon="lucide:check-circle-2" width={14} className="shrink-0 text-[var(--t-status-connected)]" />
              )}
              {updater.status === "error" && (
                <Icon icon="lucide:alert-circle" width={14} className="shrink-0 text-[var(--t-status-error)]" />
              )}
              {(updater.status === "idle" || updater.status === "upToDate" || updater.status === "checking") && (
                <span className="text-sm text-[var(--t-text-primary)]">
                  {updater.status === "idle" && "Not checked yet"}
                  {updater.status === "checking" && "Checking for updates…"}
                  {updater.status === "upToDate" && "You're up to date"}
                </span>
              )}
              {updater.status === "downloading" && (
                <span className="text-sm text-[var(--t-text-primary)]">
                  Downloading v{updater.version} — {updater.progress}%
                </span>
              )}
              {updater.status === "ready" && (
                <span className="text-sm text-[var(--t-text-primary)]">
                  v{updater.version} ready to install
                </span>
              )}
              {updater.status === "error" && (
                <span className="text-sm break-all text-[var(--t-status-error)]">
                  {updater.message}
                </span>
              )}
            </div>

            {updater.status !== "ready" && (
              <button
                onClick={() => checkForUpdate()}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 bg-[var(--t-bg-input)]"
                style={{
                  color: busy ? "var(--t-text-dim)" : "var(--t-text-primary)",
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <Icon icon="lucide:refresh-cw" width={12} className={busy ? "animate-spin" : ""} />
                Check for update
              </button>
            )}
          </div>

          {/* Progress bar while downloading */}
          {updater.status === "downloading" && (
            <div className="h-1 rounded-full overflow-hidden bg-[var(--t-bg-input)]">
              <div
                className="h-full rounded-full transition-all bg-[var(--t-accent)]"
                style={{ width: `${updater.progress}%` }}
              />
            </div>
          )}

          {/* Install button */}
          {updater.status === "ready" && (
            <button
              onClick={() => installUpdate()}
              className="w-full py-2 rounded-lg text-sm font-medium text-white transition-colors bg-[var(--t-accent)]"
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-accent-hover)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-accent)"; }}
            >
              Restart & install v{updater.version}
            </button>
          )}
        </div>
      </div>
      {/* Links */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          Links
        </h3>
        <a
          href="https://github.com/VoltiusApp/voltius"
          target="_blank"
          rel="noreferrer"
          className="rounded-lg px-4 py-3 flex items-center gap-3 bg-[var(--t-bg-elevated)] border border-[var(--t-border)] transition-colors hover:border-[var(--t-border-hover)]"
        >
          <Icon icon="simple-icons:github" width={16} className="text-[var(--t-accent)] shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--t-text-primary)]">GitHub</p>
            <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">VoltiusApp/voltius</p>
          </div>
          <Icon icon="lucide:external-link" width={13} className="ml-auto text-[var(--t-text-dim)]" />
        </a>
      </div>
    </div>
  );
}
