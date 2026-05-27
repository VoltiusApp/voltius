import { useState } from "react";
import { useHostPingStore } from "@/stores/hostPingStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { Toggle } from "@/components/shared/Toggle";

export default function HostsSection() {
  const [enabled, setEnabled] = useToggle("reachability");
  const [presenceEnabled, setPresenceEnabled] = useToggle("team-presence");
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
          <div className="flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--t-text-primary)]">Reachability check</p>
              <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">
                Probes the SSH port and shows a status dot + latency on each host card.
                Can be disabled per host in the host's settings.
              </p>
            </div>
            <Toggle checked={enabled} onChange={setEnabled} />
          </div>
          {enabled && (
            <>
              <div className="flex items-center justify-between px-4 py-3 gap-4">
                <div>
                  <p className="text-sm font-medium text-[var(--t-text-primary)]">Poll interval</p>
                  <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">Background check cadence for the hosts page.</p>
                </div>
                <div className="flex items-center gap-1.5">
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
              <div className="flex items-center justify-between px-4 py-3 gap-4">
                <div>
                  <p className="text-sm font-medium text-[var(--t-text-primary)]">Active session interval</p>
                  <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">Faster cadence used for the latency chip in the terminal status bar.</p>
                </div>
                <div className="flex items-center gap-1.5">
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
          Team presence
        </h3>
        <div className="rounded-lg bg-[var(--t-bg-elevated)] border border-[var(--t-border)]">
          <div className="flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--t-text-primary)]">
                Share which team-vault hosts you're using
              </p>
              <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">
                When on, your avatar appears on a host card while you have a terminal open to it.
                Only teammates with access to the host see it.
              </p>
            </div>
            <Toggle checked={presenceEnabled} onChange={setPresenceEnabled} />
          </div>
        </div>
      </div>
    </div>
  );
}
