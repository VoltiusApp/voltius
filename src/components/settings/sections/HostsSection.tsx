import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MIN_ACTIVE_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS, useHostPingStore } from "@/stores/hostPingStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import {
  GLOBAL_PROXY_MODES,
  useConnectivitySettingsStore,
  useGlobalKeepalivePreset,
  useGlobalProxy,
  type GlobalProxy,
} from "@/stores/connectivitySettingsStore";
import { deleteSecret, getSecret, storeSecret } from "@/services/vault";
import { detectSystemProxy, type DetectedProxy } from "@/services/proxy";
import { GLOBAL_PROXY_PASSWORD_KEY } from "@/services/teamVaultSecretKeys";
import ProxyFields from "@/components/connections/ProxyFields";
import { KEEPALIVE_PRESETS } from "@/utils/keepalive";
import { SshConfigGroup } from "@/components/sshConfig/SshConfigGroup";
import { SshConfigHostsDialog } from "@/components/sshConfig/SshConfigHostsDialog";
import { Setting } from "@/components/settings/Setting";
import { useSettingState } from "@/components/settings/registry/useSettingState";
import { SettingRow, SettingsGroup } from "./shared";

export default function HostsSection() {
  const { t } = useTranslation();
  const [detachedTtlOn] = useToggle("detached-session-ttl");
  const [enabled] = useToggle("reachability");
  const [keepalivePreset] = useGlobalKeepalivePreset();
  const [globalProxy, setGlobalProxy] = useGlobalProxy();
  const proxyState = useSettingState("connectivity.proxy");
  const poll = useSettingState("hosts.pollIntervalMs");
  const activePoll = useSettingState("hosts.activePollIntervalMs");
  const globalProxyModes = useMemo(
    () => GLOBAL_PROXY_MODES.map((m) => ({ value: m, label: t(`settings.hosts.proxy.modes.${m}`) })),
    [t],
  );
  const ownProxy = useConnectivitySettingsStore((s) => s.proxy);
  const [proxyDraft, setProxyDraft] = useState(ownProxy);
  const pendingProxy = useRef<GlobalProxy | null>(null);
  useEffect(() => {
    if (pendingProxy.current === null) setProxyDraft(ownProxy);
  }, [ownProxy]);
  const commitProxy = useCallback(() => {
    const next = pendingProxy.current;
    if (next === null) return;
    pendingProxy.current = null;
    setGlobalProxy(next);
  }, [setGlobalProxy]);
  useEffect(() => commitProxy, [commitProxy]);
  const changeProxy = (next: GlobalProxy) => {
    pendingProxy.current = next;
    setProxyDraft(next);
    if (next.mode !== proxyDraft.mode || next.port !== proxyDraft.port) commitProxy();
  };
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
    <div className="p-6 space-y-6">
      <SettingsGroup title={t("settings.hosts.connectivityTitle")} divided>
        <Setting id="toggles.reachability" />
        {enabled && (
          <>
            <SettingRow
              title={t("settings.hosts.pollInterval.title")}
              desc={t("settings.hosts.pollInterval.desc")}
              dirty={poll.dirty}
              onReset={poll.canReset ? () => {
                poll.reset();
                setRaw(String(useHostPingStore.getState().pollIntervalMs));
              } : undefined}
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
              dirty={activePoll.dirty}
              onReset={activePoll.canReset ? () => {
                activePoll.reset();
                setRawActive(String(useHostPingStore.getState().activePollIntervalMs));
              } : undefined}
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
        <Setting
          id="connectivity.keepalivePreset"
          desc={t("settings.hosts.keepalive.desc", { detail: t(KEEPALIVE_PRESETS[keepalivePreset].detailKey) })}
        />
        <div>
          <ProxyFields
            modes={globalProxyModes}
            value={proxyDraft}
            onChange={(p) => changeProxy(p as GlobalProxy)}
            onTextBlur={commitProxy}
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
                dirty={proxyState.dirty}
                onReset={proxyState.canReset ? proxyState.reset : undefined}
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
        <Setting id="toggles.persistent-sessions" />
        <Setting id="toggles.detached-session-ttl" />
        {detachedTtlOn && <Setting id="connectivity.detachedTtlHours" />}
      </SettingsGroup>

      <SshConfigGroup />

      <SettingsGroup title={t("settings.hosts.terminalTitle")}>
        <Setting id="toggles.shell-integration" />
      </SettingsGroup>

      <SettingsGroup title={t("settings.hosts.teamPresenceTitle")}>
        <Setting id="toggles.team-presence" />
      </SettingsGroup>
      <SshConfigHostsDialog />
    </div>
  );
}
