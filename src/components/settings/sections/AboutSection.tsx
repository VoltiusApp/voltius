import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { getVersion } from "@tauri-apps/api/app";

const LINKS = [
  { icon: "simple-icons:github", label: "GitHub",  sub: "VoltiusApp/voltius", href: "https://github.com/VoltiusApp/voltius" },
  { icon: "lucide:book-open", label: "Documentation", sub: "docs.voltius.app", href: "https://docs.voltius.app" },
  { icon: "simple-icons:x",      label: "X",        sub: "@VoltiusApp",        href: "https://x.com/VoltiusApp" },
  { icon: "simple-icons:kofi",   label: "Ko-Fi",   sub: "ko-fi.com/kipavy",   href: "https://ko-fi.com/kipavy" },
  { icon: "lucide:mail", label: "Contact", sub: "contact@voltius.app", href: "mailto:contact@voltius.app" },
];
import {
  getUpdaterState,
  onUpdaterStateChange,
  checkForUpdate,
  installUpdate,
} from "@/services/updater";
import { Toggle } from "@/components/shared/Toggle";
import { useUpdaterPrefStore } from "@/stores/updaterPrefStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import LogoBadge from "@/components/layout/LogoBadge";

export default function AboutSection() {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updater, setUpdater] = useState(getUpdaterState);
  const autoUpdate = useUpdaterPrefStore((s) => s.autoUpdate);
  const setAutoUpdate = useUpdaterPrefStore((s) => s.setAutoUpdate);
  const [changelogPopup, setChangelogPopup] = useToggle("changelog-popup");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"));
    return onUpdaterStateChange(() => setUpdater(getUpdaterState()));
  }, []);

  const busy = updater.status === "checking" || updater.status === "downloading";

  return (
    <div className="p-6 max-w-lg space-y-6">
      {/* App version */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          Version
        </h3>
        <div
          className="rounded-lg px-4 py-3 flex items-center gap-3 bg-(--t-bg-elevated) border border-(--t-border)"
        >
          <LogoBadge size={10} />
          <div>
            <p className="text-sm font-medium text-(--t-text-primary)">Voltius</p>
            <p className="text-xs mt-0.5 text-(--t-text-dim)">
              {appVersion ? `v${appVersion}` : "Loading…"}
            </p>
          </div>
        </div>
      </div>

      {/* Update */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          Updates
        </h3>
        <div
          className="rounded-lg px-4 py-3 space-y-3 bg-(--t-bg-elevated) border border-(--t-border)"
        >
          {/* Status line */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {updater.status === "checking" && (
                <Icon icon="lucide:loader-2" width={14} className="animate-spin shrink-0 text-(--t-accent)" />
              )}
              {updater.status === "downloading" && (
                <Icon icon="lucide:download" width={14} className="shrink-0 text-(--t-accent)" />
              )}
              {updater.status === "ready" && (
                <Icon icon="lucide:check-circle-2" width={14} className="shrink-0 text-(--t-status-connected)" />
              )}
              {updater.status === "upToDate" && (
                <Icon icon="lucide:check-circle-2" width={14} className="shrink-0 text-(--t-status-connected)" />
              )}
              {updater.status === "error" && (
                <Icon icon="lucide:alert-circle" width={14} className="shrink-0 text-(--t-status-error)" />
              )}
              {(updater.status === "idle" || updater.status === "upToDate" || updater.status === "checking") && (
                <span className="text-sm text-(--t-text-primary)">
                  {updater.status === "idle" && "Not checked yet"}
                  {updater.status === "checking" && "Checking for updates…"}
                  {updater.status === "upToDate" && "You're up to date"}
                </span>
              )}
              {updater.status === "downloading" && (
                <span className="text-sm text-(--t-text-primary)">
                  Downloading v{updater.version} — {updater.progress}%
                </span>
              )}
              {updater.status === "ready" && (
                <span className="text-sm text-(--t-text-primary)">
                  v{updater.version} ready to install
                </span>
              )}
              {updater.status === "error" && (
                <span className="text-sm break-all text-(--t-status-error)">
                  {updater.message}
                </span>
              )}
            </div>

            {updater.status !== "ready" && (
              <button
                onClick={() => checkForUpdate()}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 bg-(--t-bg-input)"
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
            <div className="h-1 rounded-full overflow-hidden bg-(--t-bg-input)">
              <div
                className="h-full rounded-full transition-all bg-(--t-accent)"
                style={{ width: `${updater.progress}%` }}
              />
            </div>
          )}

          {/* Restart button */}
          {updater.status === "ready" && (
            <button
              onClick={() => installUpdate()}
              className="btn btn-primary w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium"
            >
              <Icon icon="lucide:refresh-cw" width={14} />
              Restart to update · v{updater.version}
            </button>
          )}

          {/* Automatic updates toggle */}
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-(--t-border)">
            <div className="min-w-0">
              <p className="text-sm text-(--t-text-primary)">Auto-download updates</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">
                Check &amp; download new versions in the background
              </p>
            </div>
            <Toggle checked={autoUpdate} onChange={setAutoUpdate} />
          </div>

          {/* What's new popup toggle */}
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-(--t-border)">
            <div className="min-w-0">
              <p className="text-sm text-(--t-text-primary)">Show what's new after updates</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">
                Open the changelog automatically on a new release
              </p>
            </div>
            <Toggle checked={changelogPopup} onChange={setChangelogPopup} />
          </div>
        </div>
      </div>
      {/* Links */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          Links
        </h3>
        <div className="space-y-2">
          {LINKS.map(({ icon, label, sub, href }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg px-4 py-3 flex items-center gap-3 bg-(--t-bg-elevated) border border-(--t-border) transition-colors hover:border-(--t-border-hover)"
            >
              <Icon icon={icon} width={20} className="text-(--t-text-primary) shrink-0" />
              <div>
                <p className="text-sm font-medium text-(--t-text-primary)">{label}</p>
                <p className="text-xs mt-0.5 text-(--t-text-dim)">{sub}</p>
              </div>
              <Icon icon="lucide:external-link" width={20} className="ml-auto text-(--t-text-dim)" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
