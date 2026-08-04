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
import { DirtyDot, ResetButton } from "./shared";

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
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          {t("settings.hosts.connectivityTitle")}
        </h3>
        <div className="rounded-lg bg-(--t-bg-elevated) border border-(--t-border) divide-y divide-(--t-border)">
          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.hosts.reachability.title")}</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">
                {t("settings.hosts.reachability.desc")}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {enabled !== TOGGLE_DEFS.reachability.default && (
                <ResetButton onReset={() => setEnabled(TOGGLE_DEFS.reachability.default)} />
              )}
              {enabled !== TOGGLE_DEFS.reachability.default && <DirtyDot />}
              <Toggle checked={enabled} onChange={setEnabled} />
            </div>
          </div>
          {enabled && (
            <>
              <div className="group flex items-center justify-between px-4 py-3 gap-4">
                <div>
                  <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.hosts.pollInterval.title")}</p>
                  <p className="text-xs mt-0.5 text-(--t-text-dim)">{t("settings.hosts.pollInterval.desc")}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {pollIntervalMs !== DEFAULT_POLL_INTERVAL_MS && (
                    <ResetButton
                      onReset={() => {
                        setPollIntervalMs(DEFAULT_POLL_INTERVAL_MS);
                        setRaw(String(DEFAULT_POLL_INTERVAL_MS));
                      }}
                    />
                  )}
                  {pollIntervalMs !== DEFAULT_POLL_INTERVAL_MS && <DirtyDot />}
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
                </div>
              </div>
              <div className="group flex items-center justify-between px-4 py-3 gap-4">
                <div>
                  <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.hosts.activeInterval.title")}</p>
                  <p className="text-xs mt-0.5 text-(--t-text-dim)">{t("settings.hosts.activeInterval.desc")}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {activePollIntervalMs !== DEFAULT_ACTIVE_POLL_INTERVAL_MS && (
                    <ResetButton
                      onReset={() => {
                        setActivePollIntervalMs(DEFAULT_ACTIVE_POLL_INTERVAL_MS);
                        setRawActive(String(DEFAULT_ACTIVE_POLL_INTERVAL_MS));
                      }}
                    />
                  )}
                  {activePollIntervalMs !== DEFAULT_ACTIVE_POLL_INTERVAL_MS && <DirtyDot />}
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
                </div>
              </div>
            </>
          )}
          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.hosts.keepalive.title")}</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">
                {t("settings.hosts.keepalive.desc", { detail: t(KEEPALIVE_PRESETS[keepalivePreset].detailKey) })}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {keepalivePreset !== DEFAULT_KEEPALIVE_PRESET && (
                <ResetButton onReset={() => setKeepalivePreset(DEFAULT_KEEPALIVE_PRESET)} />
              )}
              {keepalivePreset !== DEFAULT_KEEPALIVE_PRESET && <DirtyDot />}
              <FormSelect
                className="w-36 shrink-0"
                value={keepalivePreset}
                options={keepaliveOptions}
                onChange={(v) => setKeepalivePreset(v as KeepalivePreset)}
              />
            </div>
          </div>
          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.hosts.persistentSessions.title")}</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">
                {t("settings.hosts.persistentSessions.desc")}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {persistSessions !== PERSIST_SESSIONS_DEFAULT && (
                <ResetButton onReset={() => setPersistSessions(PERSIST_SESSIONS_DEFAULT)} />
              )}
              {persistSessions !== PERSIST_SESSIONS_DEFAULT && <DirtyDot />}
              <Toggle checked={persistSessions} onChange={setPersistSessions} />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          {t("settings.hosts.terminalTitle")}
        </h3>
        <div className="rounded-lg bg-(--t-bg-elevated) border border-(--t-border)">
          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.hosts.shellIntegration.title")}</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">
                {t("settings.hosts.shellIntegration.desc")}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {shellIntegration !== SHELL_INTEGRATION_DEFAULT && (
                <ResetButton onReset={() => setShellIntegration(SHELL_INTEGRATION_DEFAULT)} />
              )}
              {shellIntegration !== SHELL_INTEGRATION_DEFAULT && <DirtyDot />}
              <Toggle checked={shellIntegration} onChange={setShellIntegration} />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          {t("settings.hosts.teamPresenceTitle")}
        </h3>
        <div className="rounded-lg bg-(--t-bg-elevated) border border-(--t-border)">
          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-(--t-text-primary)">
                {t("settings.hosts.teamPresence.title")}
              </p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">
                {t("settings.hosts.teamPresence.desc")}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {presenceEnabled !== TOGGLE_DEFS["team-presence"].default && (
                <ResetButton onReset={() => setPresenceEnabled(TOGGLE_DEFS["team-presence"].default)} />
              )}
              {presenceEnabled !== TOGGLE_DEFS["team-presence"].default && <DirtyDot />}
              <Toggle checked={presenceEnabled} onChange={setPresenceEnabled} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
