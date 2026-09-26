import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_ACTIVE_POLL_INTERVAL_MS,
  DEFAULT_POLL_INTERVAL_MS,
  MIN_ACTIVE_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  useHostPingStore,
} from "@/stores/hostPingStore";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import {
  DEFAULT_GLOBAL_PROXY,
  GLOBAL_PROXY_MODES,
  useGlobalKeepalivePreset,
  useGlobalProxy,
  type GlobalProxy,
} from "@/stores/connectivitySettingsStore";
import { deleteSecret, getSecret, storeSecret } from "@/services/vault";
import { detectSystemProxy, type DetectedProxy } from "@/services/proxy";
import { GLOBAL_PROXY_PASSWORD_KEY } from "@/services/teamVaultSecretKeys";
import ProxyFields from "@/components/connections/ProxyFields";
import { DEFAULT_KEEPALIVE_PRESET, KEEPALIVE_PRESETS, type KeepalivePreset } from "@/utils/keepalive";
import { Toggle } from "@/components/shared/Toggle";
import { FormSelect } from "@/components/shared/FormSelect";
import { SettingRow, SettingsGroup } from "./shared";

const SHELL_INTEGRATION_DEFAULT = TOGGLE_DEFS["shell-integration"].default;
const PERSIST_SESSIONS_DEFAULT = TOGGLE_DEFS["persistent-sessions"].default;

export default function HostsSection() {
  const { t } = useTranslation();
  const keepaliveOptions = useMemo(
    () => (Object.keys(KEEPALIVE_PRESETS) as KeepalivePreset[]).map(
      (p) => ({ value: p, label: t(KEEPALIVE_PRESETS[p].labelKey) }),
    ),
    [t],
  );
  const [enabled, setEnabled] = useToggle("reachability");
  const [presenceEnabled, setPresenceEnabled] = useToggle("team-presence");
  const [shellIntegration, setShellIntegration] = useToggle("shell-integration");
  const [keepalivePreset, setKeepalivePreset] = useGlobalKeepalivePreset();
  const [persistSessions, setPersistSessions] = useToggle("persistent-sessions");
  const [globalProxy, setGlobalProxy] = useGlobalProxy();
  const globalProxyModes = useMemo(
    () => GLOBAL_PROXY_MODES.map((m) => ({ value: m, label: t(`settings.hosts.proxy.modes.${m}`) })),
    [t],
  );
  const [proxyPassword, setProxyPassword] = useState("");
  const pendingProxyPassword = useRef<string | null>(null);
  const [proxyPasswordSaved, setProxyPasswordSaved] = useState(false);
  const [detectedProxy, setDetectedProxy] = useState<DetectedProxy | null>(null);
  useEffect(() => {
    getSecret(GLOBAL_PROXY_PASSWORD_KEY).then((v) => setProxyPasswordSaved(!!v)).catch(() => {});
  }, []);
  useEffect(() => {
    if (globalProxy.mode !== "system") return;
    detectSystemProxy().then(setDetectedProxy).catch(() => setDetectedProxy(null));
  }, [globalProxy.mode]);
  const [proxyPasswordError, setProxyPasswordError] = useState<string | null>(null);
  const commitProxyPassword = useCallback(() => {
    const pw = pendingProxyPassword.current;
    if (pw === null) return;
    pendingProxyPassword.current = null;
    (pw ? storeSecret(GLOBAL_PROXY_PASSWORD_KEY, pw) : deleteSecret(GLOBAL_PROXY_PASSWORD_KEY))
      .then(() => {
        if (pendingProxyPassword.current === null) setProxyPassword("");
        setProxyPasswordSaved(!!pw);
        setProxyPasswordError(null);
      })
      .catch((err: unknown) => {
        pendingProxyPassword.current ??= pw;
        setProxyPasswordError(err instanceof Error ? err.message : String(err));
      });
  }, []);
  useEffect(() => commitProxyPassword, [commitProxyPassword]);
  const pollIntervalMs = useHostPingStore((s) => s.pollIntervalMs);
  const setPollIntervalMs = useHostPingStore((s) => s.setPollIntervalMs);
  const activePollIntervalMs = useHostPingStore((s) => s.activePollIntervalMs);
  const setActivePollIntervalMs = useHostPingStore((s) => s.setActivePollIntervalMs);

  const [raw, setRaw] = useState(() => String(pollIntervalMs));
  const [rawActive, setRawActive] = useState(() => String(activePollIntervalMs));

  const commit = (value: string) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= MIN_POLL_INTERVAL_MS) setPollIntervalMs(n);
    else setRaw(String(pollIntervalMs));
  };

  const commitActive = (value: string) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= MIN_ACTIVE_POLL_INTERVAL_MS) setActivePollIntervalMs(n);
    else setRawActive(String(activePollIntervalMs));
  };

  return (
    <div className="p-6 max-w-lg space-y-6">
      <SettingsGroup title={t("settings.hosts.connectivityTitle")} divided>
        <SettingRow
          syncKey="appSettings.toggles.reachability"
          title={t("settings.hosts.reachability.title")}
          desc={t("settings.hosts.reachability.desc")}
          dirty={enabled !== TOGGLE_DEFS.reachability.default}
          onReset={() => setEnabled(TOGGLE_DEFS.reachability.default)}
        >
          <Toggle checked={enabled} onChange={setEnabled} />
        </SettingRow>
        {enabled && (
          <>
            <SettingRow
              title={t("settings.hosts.pollInterval.title")}
              desc={t("settings.hosts.pollInterval.desc")}
              dirty={pollIntervalMs !== DEFAULT_POLL_INTERVAL_MS}
              onReset={() => {
                setPollIntervalMs(DEFAULT_POLL_INTERVAL_MS);
                setRaw(String(DEFAULT_POLL_INTERVAL_MS));
              }}
            >
              <input
                type="number"
                min={1}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                onBlur={(e) => commit(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commit(raw)}
                className="w-24 px-2 py-1 rounded-sm text-xs text-right bg-(--t-bg-base) border border-(--t-border) text-(--t-text-primary) focus:outline-hidden focus:border-(--t-tab-active-text)"
              />
              <span className="text-xs text-(--t-text-dim)">{t("settings.hosts.ms")}</span>
            </SettingRow>
            <SettingRow
              title={t("settings.hosts.activeInterval.title")}
              desc={t("settings.hosts.activeInterval.desc")}
              dirty={activePollIntervalMs !== DEFAULT_ACTIVE_POLL_INTERVAL_MS}
              onReset={() => {
                setActivePollIntervalMs(DEFAULT_ACTIVE_POLL_INTERVAL_MS);
                setRawActive(String(DEFAULT_ACTIVE_POLL_INTERVAL_MS));
              }}
            >
              <input
                type="number"
                min={1}
                value={rawActive}
                onChange={(e) => setRawActive(e.target.value)}
                onBlur={(e) => commitActive(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commitActive(rawActive)}
                className="w-24 px-2 py-1 rounded-sm text-xs text-right bg-(--t-bg-base) border border-(--t-border) text-(--t-text-primary) focus:outline-hidden focus:border-(--t-tab-active-text)"
              />
              <span className="text-xs text-(--t-text-dim)">{t("settings.hosts.ms")}</span>
            </SettingRow>
          </>
        )}
        <SettingRow
          syncKey="appSettings.keepalivePreset"
          title={t("settings.hosts.keepalive.title")}
          desc={t("settings.hosts.keepalive.desc", { detail: t(KEEPALIVE_PRESETS[keepalivePreset].detailKey) })}
          dirty={keepalivePreset !== DEFAULT_KEEPALIVE_PRESET}
          onReset={() => setKeepalivePreset(DEFAULT_KEEPALIVE_PRESET)}
        >
          <FormSelect
            className="w-36 shrink-0"
            value={keepalivePreset}
            options={keepaliveOptions}
            onChange={(v) => setKeepalivePreset(v as KeepalivePreset)}
          />
        </SettingRow>
        <div>
          <ProxyFields
            modes={globalProxyModes}
            value={globalProxy}
            onChange={(p) => setGlobalProxy(p as GlobalProxy)}
            password={proxyPassword}
            passwordSaved={proxyPasswordSaved}
            onPasswordChange={(pw) => { pendingProxyPassword.current = pw; setProxyPassword(pw); }}
            onPasswordBlur={commitProxyPassword}
            passwordError={proxyPasswordError === null ? undefined : t("settings.hosts.proxy.passwordSaveFailed", { error: proxyPasswordError })}
            className="px-4 pb-3"
            renderRow={(select) => (
              <SettingRow
                syncKey="appSettings.proxy"
                title={t("settings.hosts.proxy.title")}
                desc={t("settings.hosts.proxy.desc")}
                dirty={globalProxy.mode !== DEFAULT_GLOBAL_PROXY.mode}
                onReset={() => setGlobalProxy(DEFAULT_GLOBAL_PROXY)}
              >
                {select}
              </SettingRow>
            )}
          />
          {globalProxy.mode === "system" && (
            <p className="px-4 pb-3 -mt-1 text-xs text-(--t-text-dim)">
              {detectedProxy
                ? t("settings.hosts.proxy.detected", {
                  kind: t(`settings.hosts.proxy.modes.${detectedProxy.kind}`),
                  host: detectedProxy.host,
                  port: detectedProxy.port,
                })
                : t("settings.hosts.proxy.detectedNone")}
            </p>
          )}
        </div>
        <SettingRow
          syncKey="appSettings.toggles.persistent-sessions"
          title={t("settings.hosts.persistentSessions.title")}
          desc={t("settings.hosts.persistentSessions.desc")}
          dirty={persistSessions !== PERSIST_SESSIONS_DEFAULT}
          onReset={() => setPersistSessions(PERSIST_SESSIONS_DEFAULT)}
        >
          <Toggle checked={persistSessions} onChange={setPersistSessions} />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.hosts.terminalTitle")}>
        <SettingRow
          syncKey="appSettings.toggles.shell-integration"
          title={t("settings.hosts.shellIntegration.title")}
          desc={t("settings.hosts.shellIntegration.desc")}
          dirty={shellIntegration !== SHELL_INTEGRATION_DEFAULT}
          onReset={() => setShellIntegration(SHELL_INTEGRATION_DEFAULT)}
        >
          <Toggle checked={shellIntegration} onChange={setShellIntegration} />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.hosts.teamPresenceTitle")}>
        <SettingRow
          syncKey="appSettings.toggles.team-presence"
          title={t("settings.hosts.teamPresence.title")}
          desc={t("settings.hosts.teamPresence.desc")}
          dirty={presenceEnabled !== TOGGLE_DEFS["team-presence"].default}
          onReset={() => setPresenceEnabled(TOGGLE_DEFS["team-presence"].default)}
        >
          <Toggle checked={presenceEnabled} onChange={setPresenceEnabled} />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
