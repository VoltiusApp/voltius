import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_ACTIVE_POLL_INTERVAL_MS,
  DEFAULT_POLL_INTERVAL_MS,
  MIN_ACTIVE_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  useHostPingStore,
} from "@/stores/hostPingStore";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { useGlobalKeepalivePreset } from "@/stores/connectivitySettingsStore";
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
        <SettingRow
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
