import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Toggle } from "@/components/shared/Toggle";
import type { SyncStatus } from "@/services/sync";
import { runManualSync } from "@/services/syncIntent";
import { useSyncProviders } from "@/hooks/useSyncProviders";
import { useAvailableSyncProviders } from "@/hooks/useAvailableSyncProviders";
import { usePluginInstaller } from "@/components/settings/usePluginInstaller";
import { runSyncProviderAction } from "@/services/syncProviderAction";
import { VOLTIUS_PROVIDER_ID, type SyncProviderView } from "@/services/syncProviders";
import { AvailableSyncProviderRow } from "@/components/shared/AvailableSyncProviderRow";
import { useSyncPrefsStore, SYNC_OBJECT_TYPES, SYNC_SETTING_DOMAINS } from "@/stores/syncPrefsStore";
import { setDomainSync, setKeySync } from "@/services/user-data/syncChoice";
import { heldBackKeys } from "@/services/user-data/syncFilter";
import { isDeviceScopedDefault } from "@/services/user-data/settingKeys";
import { SettingsGroup } from "./shared";

function syncStateLine(t: TFunction, s: { status: SyncStatus; lastSync: Date | null; error: string | null }): string {
  switch (s.status) {
    case "syncing": return t("settings.sync.active.syncing");
    case "error": return t("settings.sync.active.error", { error: s.error ?? "unknown" });
    case "success": return s.lastSync ? t("settings.sync.active.lastSync", { time: s.lastSync.toLocaleTimeString() }) : "";
    case "offline": return t("settings.sync.active.offline");
    default: return t("settings.sync.active.idle");
  }
}

function SyncNowButton({ provider }: { provider: SyncProviderView }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  if (!provider.syncNow) return null;
  const syncNow = provider.syncNow;
  const syncing = pending || provider.state.status === "syncing";

  const handleSync = () => {
    if (syncing) return;
    setPending(true);
    runManualSync(syncNow).catch(() => {}).finally(() => setPending(false));
  };

  return (
    <button
      onClick={handleSync}
      disabled={syncing}
      className="flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors shrink-0 bg-(--t-bg-input)"
      style={{
        color: provider.state.status === "error" ? "var(--t-status-error)" : "var(--t-text-muted)",
        opacity: syncing ? 0.5 : 1,
      }}
    >
      <Icon icon="lucide:refresh-cw" width={18} />
      {t("settings.sync.active.syncNow")}
    </button>
  );
}

function PluginProviderRow({ provider }: { provider: SyncProviderView }) {
  const { t } = useTranslation();
  const { availability, state, action } = provider;
  const sub = availability === "disabled" ? t("layout.sync.pluginDisabled")
    : availability === "not_configured" ? t("layout.sync.notConfigured")
    : syncStateLine(t, state);

  return (
    <div data-sync-provider={provider.id} className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon icon={provider.icon} width={16} className="shrink-0 text-(--t-text-muted)" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-(--t-text-primary)">{provider.label}</p>
          <p className="text-xs mt-0.5 text-(--t-text-dim)">{sub}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {action && (
          <button
            onClick={() => runSyncProviderAction(action)}
            className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-(--t-bg-input) text-(--t-text-primary) transition-opacity hover:opacity-75"
          >
            {t(availability === "disabled" ? "layout.sync.enableArrow" : "layout.sync.configureArrow")}
          </button>
        )}
        <SyncNowButton provider={provider} />
      </div>
    </div>
  );
}

function VoltiusSyncGroup({ provider }: { provider: SyncProviderView }) {
  const { t } = useTranslation();
  const runAction = () => { if (provider.action) runSyncProviderAction(provider.action); };

  if (provider.availability === "locked") {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.sync.notConnected.title")}</p>
          <p className="text-xs mt-0.5 text-(--t-text-dim)">{t("settings.sync.notConnected.sub")}</p>
        </div>
        <button
          onClick={runAction}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 bg-(--t-bg-input) text-(--t-text-primary)"
        >
          {t("settings.sync.notConnected.signIn")}
        </button>
      </div>
    );
  }

  if (provider.availability === "needs_upgrade") {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.sync.requiresPro.title")}</p>
          <p className="text-xs mt-0.5 text-(--t-text-dim)">{t("settings.sync.requiresPro.sub")}</p>
        </div>
        <button
          onClick={runAction}
          className="text-xs px-2.5 py-1 rounded-md font-medium shrink-0 bg-(--t-accent) text-white hover:opacity-85 transition-opacity"
        >
          {t("settings.sync.requiresPro.upgrade")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div>
        <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.sync.active.title")}</p>
        <p className="text-xs mt-0.5 text-(--t-text-dim)">{syncStateLine(t, provider.state)}</p>
      </div>
      <SyncNowButton provider={provider} />
    </div>
  );
}

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

function HeldBackKeys({ domain }: { domain: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Subscribing to both maps is what re-renders this row when a key is held
  // back from a settings page while this panel is mounted.
  const overrides = useSyncPrefsStore((s) => s.settingSyncOverrides);
  void useSyncPrefsStore((s) => s.syncSettingDomains);
  const keys = heldBackKeys(domain);
  if (keys.length === 0) return null;

  return (
    <div className="px-4 py-2">
      <button
        data-testid={`held-back-${domain}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-xs text-(--t-text-muted) hover:text-(--t-text-primary) transition-colors"
      >
        {t("settings.sync.heldBack.summary", { count: keys.length })}
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3">
              <span className="text-xs text-(--t-text-dim)">
                {t(k.labelKey)}
                {" · "}
                {t(
                  isDeviceScopedDefault(k.id, overrides ?? {})
                    ? "settings.sync.heldBack.deviceDefault"
                    : "settings.sync.heldBack.yourChoice",
                )}
              </span>
              <button
                data-testid={`resume-${k.id}`}
                onClick={() => setKeySync(k.id, true)}
                className="text-xs shrink-0 text-(--t-accent) hover:opacity-75 transition-opacity"
              >
                {t("settings.sync.heldBack.resume")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SyncSection() {
  const { t } = useTranslation();
  const { syncTypes, setSyncType, isDomainSynced } = useSyncPrefsStore();

  const providers = useSyncProviders().providers;
  const voltiusProvider = providers.find((p) => p.id === VOLTIUS_PROVIDER_ID);
  const pluginProviders = providers.filter((p) => p.id !== VOLTIUS_PROVIDER_ID);
  const { available, appVersion } = useAvailableSyncProviders();
  const installer = usePluginInstaller();

  return (
    <div className="p-6 max-w-lg space-y-6">
      <SettingsGroup title={t("settings.sync.voltiusCloud")}>
        {voltiusProvider && <VoltiusSyncGroup provider={voltiusProvider} />}
      </SettingsGroup>

      {pluginProviders.length + available.length > 0 && (
        <SettingsGroup title={t("settings.sync.providersTitle")} divided>
          {pluginProviders.map((provider) => <PluginProviderRow key={provider.id} provider={provider} />)}
          {available.map((plugin) => (
            <AvailableSyncProviderRow
              key={plugin.id}
              plugin={plugin}
              appVersion={appVersion}
              busy={installer.busy.has(plugin.id)}
              onInstall={() => installer.startInstall(plugin)}
            />
          ))}
        </SettingsGroup>
      )}
      {installer.modal}

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
            <div key={id}>
              <SyncToggleRow
                domain={id}
                label={t(`settings.sync.settingDomain.${id}.label`)}
                sub={t(`settings.sync.settingDomain.${id}.sub`)}
                checked={isDomainSynced(id)}
                onChange={(v) => setDomainSync(id, v)}
              />
              <HeldBackKeys domain={id} />
            </div>
          ))}
        </SettingsGroup>
        <p className="text-xs mt-2 px-1 text-(--t-text-muted)">{t("settings.sync.settingsFooter")}</p>
      </div>
    </div>
  );
}
