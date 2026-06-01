import { useState } from "react";
import {
  DEFAULT_ACTIVE_POLL_INTERVAL_MS,
  DEFAULT_POLL_INTERVAL_MS,
  useHostPingStore,
} from "@/stores/hostPingStore";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { Toggle } from "@/components/shared/Toggle";
import { DirtyDot, ResetButton } from "./shared";

const SHELL_INTEGRATION_DEFAULT = TOGGLE_DEFS["shell-integration"].default;

export default function HostsSection() {
  const [enabled, setEnabled] = useToggle("reachability");
  const [presenceEnabled, setPresenceEnabled] = useToggle("team-presence");
  const [shellIntegration, setShellIntegration] = useToggle("shell-integration");
  const pollIntervalMs = useHostPingStore((s) => s.pollIntervalMs);
  const setPollIntervalMs = useHostPingStore((s) => s.setPollIntervalMs);
  const activePollIntervalMs = useHostPingStore((s) => s.activePollIntervalMs);
  const setActivePollIntervalMs = useHostPingStore((s) => s.setActivePollIntervalMs);

  const [raw, setRaw] = useState(() => String(pollIntervalMs));
  const [rawActive, setRawActive] = useState(() => String(activePollIntervalMs));

  const commit = (value: string) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= 1) setPollIntervalMs(n);
    else setRaw(String(pollIntervalMs));
  };

  const commitActive = (value: string) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= 1) setActivePollIntervalMs(n);
    else setRawActive(String(activePollIntervalMs));
  };

  return (
    <div className="p-6 max-w-lg space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          Connectivity
        </h3>
        <div className="rounded-lg bg-[var(--t-bg-elevated)] border border-[var(--t-border)] divide-y divide-[var(--t-border)]">
          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--t-text-primary)]">Reachability check</p>
              <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">
                Probes the SSH port and shows a status dot + latency on each host card.
                Can be disabled per host in the host's settings.
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
                  <p className="text-sm font-medium text-[var(--t-text-primary)]">Poll interval</p>
                  <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">Background check cadence for the hosts page.</p>
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
                    className="w-24 px-2 py-1 rounded text-xs text-right bg-[var(--t-bg-base)] border border-[var(--t-border)] text-[var(--t-text-primary)] focus:outline-none focus:border-[var(--t-tab-active-text)]"
                  />
                  <span className="text-xs text-[var(--t-text-dim)]">ms</span>
                </div>
              </div>
              <div className="group flex items-center justify-between px-4 py-3 gap-4">
                <div>
                  <p className="text-sm font-medium text-[var(--t-text-primary)]">Active session interval</p>
                  <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">Faster cadence used for the latency chip in the terminal status bar.</p>
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
                    className="w-24 px-2 py-1 rounded text-xs text-right bg-[var(--t-bg-base)] border border-[var(--t-border)] text-[var(--t-text-primary)] focus:outline-none focus:border-[var(--t-tab-active-text)]"
                  />
                  <span className="text-xs text-[var(--t-text-dim)]">ms</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          Terminal
        </h3>
        <div className="rounded-lg bg-[var(--t-bg-elevated)] border border-[var(--t-border)]">
          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--t-text-primary)]">Shell integration</p>
              <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">
                Hooks the remote/local shell to report its working directory (OSC 7) for cwd-aware
                file panels. If a host's welcome banner or prompt looks wrong, disable it there.
                Can be disabled per host in the host's settings.
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
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          Team presence
        </h3>
        <div className="rounded-lg bg-[var(--t-bg-elevated)] border border-[var(--t-border)]">
          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--t-text-primary)]">
                Share which team-vault hosts you're using
              </p>
              <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">
                When on, your avatar appears on a host card while you have a terminal open to it.
                Only teammates with access to the host see it.
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
