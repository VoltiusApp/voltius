import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Toggle } from "@/components/shared/Toggle";
import { getSyncState, onSyncStateChange, syncNow } from "@/services/sync";
import { useSyncPrefsStore, SYNC_OBJECT_TYPES, SYNC_SETTING_DOMAINS } from "@/stores/syncPrefsStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useUIStore } from "@/stores/uiStore";
import { openPortal } from "@/utils/billing";
import { USER_DATA_HANDLERS } from "@/services/user-data/registry";
import { SettingsGroup } from "./shared";

function SyncToggleRow({ domain, label, sub, checked, onChange }: {
  /** Stable hook for tests and UI automation; also the handler key for settings rows. */
  domain: string;
  label: string;
  sub: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div data-sync-domain={domain} className="flex items-center justify-between gap-3 px-4 py-3">
      <div>
        <p className="text-sm font-medium text-(--t-text-primary)">{label}</p>
        <p className="text-xs mt-0.5 text-(--t-text-dim)">{sub}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} aria-label={t("settings.sync.quickToggleLabel", { label })} />
    </div>
  );
}

export default function SyncSection() {
  const { t } = useTranslation();
  const [syncState, setSyncState] = useState(getSyncState);
  useEffect(() => onSyncStateChange(() => setSyncState(getSyncState())), []);

  const accountMode = useSubscriptionStore((s) => s.accountMode);
  const isPro = useSubscriptionStore((s) => s.isPro);
  const openSettings = useUIStore((s) => s.openSettings);
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);
  const { syncTypes, setSyncType, isDomainSynced, setSyncSettingDomain } = useSyncPrefsStore();

  const isLoggedIn = accountMode === "server";

  return (
    <div className="p-6 max-w-lg space-y-6">
      <SettingsGroup title={t("settings.sync.voltiusCloud")}>
        {isLoggedIn && isPro ? (
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.sync.active.title")}</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">
                {syncState.status === "syncing" && t("settings.sync.active.syncing")}
                {syncState.status === "error" && t("settings.sync.active.error", { error: syncState.error ?? "unknown" })}
                {syncState.status === "success" && syncState.lastSync && t("settings.sync.active.lastSync", { time: syncState.lastSync.toLocaleTimeString() })}
                {syncState.status === "offline" && t("settings.sync.active.offline")}
                {syncState.status === "idle" && t("settings.sync.active.idle")}
              </p>
            </div>
            <button
              onClick={() => { if (syncState.status !== "syncing") syncNow().catch(() => {}); }}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors shrink-0 bg-(--t-bg-input)"
              style={{
                color: syncState.status === "error" ? "var(--t-status-error)" : "var(--t-text-muted)",
                opacity: syncState.status === "syncing" ? 0.5 : 1,
              }}
              disabled={syncState.status === "syncing"}
            >
              <Icon
                icon="lucide:refresh-cw"
                width={18}
                className={syncState.status === "syncing" ? "animate-spin" : ""}
              />
              {t("settings.sync.active.syncNow")}
            </button>
          </div>
        ) : isLoggedIn && !isPro ? (
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.sync.requiresPro.title")}</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">{t("settings.sync.requiresPro.sub")}</p>
            </div>
            <button
              onClick={() => openPortal()}
              className="text-xs px-2.5 py-1 rounded-md font-medium shrink-0 bg-(--t-accent) text-white hover:opacity-85 transition-opacity"
            >
              {t("settings.sync.requiresPro.upgrade")}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.sync.notConnected.title")}</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">
                {t("settings.sync.notConnected.sub")}
              </p>
            </div>
            <button
              onClick={() => openCloudAuth("signin")}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 bg-(--t-bg-input) text-(--t-text-primary)"
            >
              {t("settings.sync.notConnected.signIn")}
            </button>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("settings.sync.gistTitle")}>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.sync.gist.title")}</p>
            <p className="text-xs mt-0.5 text-(--t-text-dim)">{t("settings.sync.gist.sub")}</p>
          </div>
          <button
            onClick={() => openSettings("plugins", "plugin-gist-sync:gist-sync-settings")}
            className="text-xs px-2.5 py-1.5 rounded-lg font-medium shrink-0 bg-(--t-bg-input) text-(--t-text-primary) transition-opacity hover:opacity-75"
          >
            {t("settings.sync.gist.configure")}
          </button>
        </div>
      </SettingsGroup>

      <div>
        <SettingsGroup title={t("settings.sync.prefsTitle")} divided>
          {SYNC_OBJECT_TYPES.map(({ id }) => (
            <SyncToggleRow
              key={id}
              domain={id}
              label={t(`settings.sync.objectType.${id}.label`)}
              sub={t(`settings.sync.objectType.${id}.sub`)}
              checked={syncTypes[id] ?? true}
              onChange={(v) => setSyncType(id, v)}
            />
          ))}
        </SettingsGroup>
        <p className="text-xs mt-2 px-1 text-(--t-text-muted)">
          {t("settings.sync.prefsFooter")}
        </p>
      </div>

      <div>
        <SettingsGroup title={t("settings.sync.settingsTitle")} divided>
          {SYNC_SETTING_DOMAINS.map(({ id }) => (
            <SyncToggleRow
              key={id}
              domain={id}
              label={t(`settings.sync.settingDomain.${id}.label`)}
              sub={t(`settings.sync.settingDomain.${id}.sub`)}
              checked={isDomainSynced(id)}
              onChange={(v) => {
                setSyncSettingDomain(id, v);
                // Publishing on re-enable, so a value curated here while sync was
                // off is not silently lost to the other device's newer timestamp.
                if (v) USER_DATA_HANDLERS.find((h) => h.key === id)?.touch();
              }}
            />
          ))}
        </SettingsGroup>
        <p className="text-xs mt-2 px-1 text-(--t-text-muted)">{t("settings.sync.settingsFooter")}</p>
      </div>
    </div>
  );
}
