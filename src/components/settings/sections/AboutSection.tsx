import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { useIsAndroid } from "@/utils/platform";
import { useUIStore } from "@/stores/uiStore";

const LINKS = [
  { icon: "simple-icons:github", key: "github",        sub: "VoltiusApp/voltius",   href: "https://github.com/VoltiusApp/voltius" },
  { icon: "lucide:book-open",    key: "documentation", sub: "docs.voltius.app",     href: "https://docs.voltius.app" },
  { icon: "simple-icons:x",      key: "x",             sub: "@VoltiusApp",           href: "https://x.com/VoltiusApp" },
  { icon: "simple-icons:kofi",   key: "kofi",          sub: "ko-fi.com/kipavy",     href: "https://ko-fi.com/kipavy" },
  { icon: "lucide:mail",         key: "contact",       sub: "contact@voltius.app",  href: "mailto:contact@voltius.app" },
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
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updater, setUpdater] = useState(getUpdaterState);
  const autoUpdate = useUpdaterPrefStore((s) => s.autoUpdate);
  const setAutoUpdate = useUpdaterPrefStore((s) => s.setAutoUpdate);
  const [changelogPopup, setChangelogPopup] = useToggle("changelog-popup");
  const isAndroid = useIsAndroid();

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
          {t("settings.about.versionTitle")}
        </h3>
        <div
          className="rounded-lg px-4 py-3 flex items-center gap-3 bg-(--t-bg-elevated) border border-(--t-border)"
        >
          <LogoBadge size={10} />
          <div>
            <p className="text-sm font-medium text-(--t-text-primary)">Voltius</p>
            <p className="text-xs mt-0.5 text-(--t-text-dim)">
              {appVersion ? `v${appVersion}` : t("settings.about.loading")}
            </p>
          </div>
        </div>
      </div>

      {!isAndroid && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
            {t("settings.about.updatesTitle")}
          </h3>
          <div
            className="rounded-lg px-4 py-3 space-y-3 bg-(--t-bg-elevated) border border-(--t-border)"
          >
            {/* Status line */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                {updater.status === "checking" && (
                  <Icon icon="lucide:loader-circle" width={14} className="animate-spin shrink-0 text-(--t-accent)" />
                )}
                {updater.status === "downloading" && (
                  <Icon icon="lucide:download" width={14} className="shrink-0 text-(--t-accent)" />
                )}
                {updater.status === "ready" && (
                  <Icon icon="lucide:circle-check" width={14} className="shrink-0 text-(--t-status-connected)" />
                )}
                {updater.status === "upToDate" && (
                  <Icon icon="lucide:circle-check" width={14} className="shrink-0 text-(--t-status-connected)" />
                )}
                {updater.status === "error" && (
                  <Icon icon="lucide:circle-alert" width={14} className="shrink-0 text-(--t-status-error)" />
                )}
                {(updater.status === "idle" || updater.status === "upToDate" || updater.status === "checking") && (
                  <span className="text-sm text-(--t-text-primary)">
                    {updater.status === "idle" && t("settings.about.status.idle")}
                    {updater.status === "checking" && t("settings.about.status.checking")}
                    {updater.status === "upToDate" && t("settings.about.status.upToDate")}
                  </span>
                )}
                {updater.status === "downloading" && (
                  <span className="text-sm text-(--t-text-primary)">
                    {t("settings.about.status.downloading", { version: updater.version, progress: updater.progress })}
                  </span>
                )}
                {updater.status === "ready" && (
                  <span className="text-sm text-(--t-text-primary)">
                    {t("settings.about.status.ready", { version: updater.version })}
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
                  {t("settings.about.checkForUpdate")}
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
                {t("settings.about.restartToUpdate", { version: updater.version })}
              </button>
            )}

            {/* Automatic updates toggle */}
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-(--t-border)">
              <div className="min-w-0">
                <p className="text-sm text-(--t-text-primary)">{t("settings.about.autoDownload.title")}</p>
                <p className="text-xs mt-0.5 text-(--t-text-dim)">
                  {t("settings.about.autoDownload.desc")}
                </p>
              </div>
              <Toggle checked={autoUpdate} onChange={setAutoUpdate} />
            </div>

            {/* What's new popup toggle */}
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-(--t-border)">
              <div className="min-w-0">
                <p className="text-sm text-(--t-text-primary)">{t("settings.about.whatsNew.title")}</p>
                <p className="text-xs mt-0.5 text-(--t-text-dim)">
                  {t("settings.about.whatsNew.desc")}
                </p>
              </div>
              <Toggle checked={changelogPopup} onChange={setChangelogPopup} />
            </div>
          </div>
        </div>
      )}
      {/* Links */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          {t("settings.about.linksTitle")}
        </h3>
        <div className="space-y-2">
          {LINKS.map(({ icon, key, sub, href }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg px-4 py-3 flex items-center gap-3 bg-(--t-bg-elevated) border border-(--t-border) transition-colors hover:border-(--t-border-hover)"
            >
              <Icon icon={icon} width={20} className="text-(--t-text-primary) shrink-0" />
              <div>
                <p className="text-sm font-medium text-(--t-text-primary)">{t(`settings.about.links.${key}`)}</p>
                <p className="text-xs mt-0.5 text-(--t-text-dim)">{sub}</p>
              </div>
              <Icon icon="lucide:external-link" width={20} className="ml-auto text-(--t-text-dim)" />
            </a>
          ))}
          <button
            type="button"
            onClick={() => useUIStore.getState().openSettings("diagnostics")}
            className="w-full text-left rounded-lg px-4 py-3 flex items-center gap-3 bg-(--t-bg-elevated) border border-(--t-border) transition-colors hover:border-(--t-border-hover)"
          >
            <Icon icon="lucide:bug" width={20} className="text-(--t-text-primary) shrink-0" />
            <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.about.reportBug")}</p>
          </button>
        </div>
      </div>
    </div>
  );
}
