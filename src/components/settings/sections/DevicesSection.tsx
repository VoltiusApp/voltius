import { useEffect } from "react";
import { Icon } from "@iconify/react";
import { downloadDir } from "@tauri-apps/api/path";
import { useTranslation } from "react-i18next";
import { Toggle } from "@/components/shared/Toggle";
import { logFailure } from "@/lib/logger";
import { disconnectDevice, loadFileAccess, saveFileAccess } from "@/services/deviceFiles";
import { openSystemDialog } from "@/services/systemDialog";
import { useDeviceFilesStore, type AllowedDevice, type FileAccessConfig } from "@/stores/deviceFilesStore";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import { DEVICE_TILE_BASE, deviceIcon } from "@/utils/icons";
import { useIsAndroid } from "@/utils/platform";
import { SettingRow, SettingsGroup } from "./shared";

const BUTTON = "shrink-0 h-8 px-3 rounded-lg text-xs font-medium border border-(--t-border) bg-(--t-bg-card) text-(--t-text-secondary) hover:text-(--t-text-primary)";

type Patch = Partial<FileAccessConfig> | ((latest: FileAccessConfig) => Partial<FileAccessConfig>);

const update = (patch: Patch) => {
  const latest = useDeviceFilesStore.getState().config;
  if (!latest) return;
  const next = { ...latest, ...(typeof patch === "function" ? patch(latest) : patch) };
  void saveFileAccess(next).catch(logFailure("device-files save config"));
};

interface AccessRow {
  id: string;
  name: string;
  platform: string;
  deviceKey?: string;
}

export default function DevicesSection() {
  const { t } = useTranslation();
  const isAndroid = useIsAndroid();
  const config = useDeviceFilesStore((s) => s.config);
  const sessions = useDeviceFilesStore((s) => s.sessions);
  const known = useLanSyncStore((s) => s.known);
  useEffect(() => {
    if (!isAndroid) void loadFileAccess().catch(logFailure("device-files load config"));
  }, [isAndroid]);
  if (isAndroid || !config) return null;

  const setEnabled = async (enabled: boolean) => {
    const downloads = enabled && config.folders.length === 0 ? await downloadDir().catch(() => null) : null;
    update((latest) => (enabled && latest.folders.length === 0 ? { enabled, folders: downloads ? [downloads] : [] } : { enabled }));
  };

  const addFolder = async () => {
    const picked = await openSystemDialog({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    update((latest) => (latest.folders.includes(picked) ? {} : { folders: [...latest.folders, picked] }));
  };

  const setAlways = (deviceKey: string, name: string, always: boolean) =>
    update((latest) => {
      const exists = latest.allowed.some((a) => a.deviceKey === deviceKey);
      const allowed: AllowedDevice[] = exists
        ? latest.allowed.map((a) => (a.deviceKey === deviceKey ? { ...a, always } : a))
        : [...latest.allowed, { deviceKey, name, always, lastOpened: null }];
      return { allowed };
    });

  const revoke = (deviceKey: string) => update((latest) => ({ allowed: latest.allowed.filter((a) => a.deviceKey !== deviceKey) }));

  const listed: AccessRow[] = Object.entries(known)
    .filter(([, d]) => d.platform !== "android")
    .map(([id, d]) => ({ id, name: d.name, platform: d.platform, deviceKey: d.deviceKey }));
  const unlisted: AccessRow[] = config.allowed
    .filter((a) => !listed.some((d) => d.deviceKey === a.deviceKey))
    .map((a) => ({ id: a.deviceKey, name: a.name || a.deviceKey.slice(0, 12), platform: "", deviceKey: a.deviceKey }));
  const devices = [...listed, ...unlisted];

  return (
    <div className="p-6 space-y-6">
      <SettingsGroup title={t("settings.devices.fileAccess.title")} divided>
        <SettingRow title={t("settings.devices.fileAccess.enable.title")} desc={t("settings.devices.fileAccess.enable.desc")}>
          <Toggle checked={config.enabled} onChange={(on) => void setEnabled(on)} aria-label={t("settings.devices.fileAccess.enable.title")} />
        </SettingRow>
        <div className="px-4 py-3 space-y-1.5">
          <div className="text-xs font-medium text-(--t-text-dim)">{t("settings.devices.fileAccess.folders")}</div>
          {config.enabled && config.folders.length === 0 && (
            <div role="status" className="flex items-center gap-1.5 text-xs text-(--t-status-warning)">
              <Icon icon="lucide:triangle-alert" width={13} className="shrink-0" />
              {t("settings.devices.fileAccess.noFolders")}
            </div>
          )}
          {config.folders.map((folder) => (
            <div key={folder} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-(--t-bg-input) border border-(--t-border)">
              <Icon icon="lucide:folder" width={14} className="shrink-0 text-(--t-text-dim)" />
              <span className="flex-1 min-w-0 truncate font-mono text-xs text-(--t-text-secondary)">{folder}</span>
              <button
                aria-label={t("settings.devices.fileAccess.removeFolder", { folder })}
                onClick={() => update({ folders: config.folders.filter((f) => f !== folder) })}
                className="shrink-0 flex text-(--t-text-dim) hover:text-(--t-text-primary)"
              >
                <Icon icon="lucide:x" width={13} />
              </button>
            </div>
          ))}
          <button onClick={() => void addFolder()} className={`${BUTTON} inline-flex items-center gap-1.5`}>
            <Icon icon="lucide:plus" width={12} />
            {t("settings.devices.fileAccess.addFolder")}
          </button>
        </div>
        <SettingRow title={t("settings.devices.fileAccess.readOnly.title")} desc={t("settings.devices.fileAccess.readOnly.desc")}>
          <Toggle checked={config.readOnly} onChange={(readOnly) => update({ readOnly })} aria-label={t("settings.devices.fileAccess.readOnly.title")} />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.devices.allowed.title")} divided>
        {devices.length === 0 && <div className="px-4 py-3 text-xs text-(--t-text-dim)">{t("settings.devices.allowed.empty")}</div>}
        {devices.map((device) => {
          const key = device.deviceKey;
          const entry = key ? config.allowed.find((a) => a.deviceKey === key) : undefined;
          const connected = !!key && sessions.some((s) => s.deviceKey === key);
          return (
            <SettingRow
              key={device.id}
              title={
                <span className="flex items-center gap-2.5">
                  <span
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-(--t-text-primary)"
                    style={{ background: DEVICE_TILE_BASE }}
                  >
                    <Icon icon={deviceIcon(device.platform)} width={14} />
                  </span>
                  {device.name}
                </span>
              }
              desc={
                key ? (
                  <>
                    {entry?.always ? t("settings.devices.allowed.alwaysAllowed") : t("settings.devices.allowed.asksEachTime")}
                    {connected && (
                      <>
                        {" · "}
                        <span className="text-(--t-status-connected)">{t("settings.devices.allowed.connectedNow")}</span>
                      </>
                    )}
                  </>
                ) : (
                  t("settings.devices.allowed.needsKey")
                )
              }
            >
              {connected && (
                <button className={BUTTON} onClick={() => void disconnectDevice(key).catch(logFailure("device-files disconnect"))}>
                  {t("settings.devices.allowed.disconnect")}
                </button>
              )}
              {entry && (
                <button className={BUTTON} onClick={() => revoke(entry.deviceKey)}>
                  {t("settings.devices.allowed.revoke")}
                </button>
              )}
              <Toggle
                checked={!!entry?.always}
                disabled={!key}
                onChange={(always) => key && setAlways(key, device.name, always)}
                aria-label={t("settings.devices.allowed.alwaysLabel", { name: device.name })}
              />
            </SettingRow>
          );
        })}
      </SettingsGroup>
    </div>
  );
}
