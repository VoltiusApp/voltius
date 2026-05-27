import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { Toggle } from "@/components/shared/Toggle";
import { DirtyDot, ResetButton } from "./shared";

export default function PortForwardingSection() {
  const [autoForwardEnabled, setAutoForwardEnabled] = useToggle("auto-forward");
  const [autoForwardNotificationsEnabled, setAutoForwardNotificationsEnabled] = useToggle("forwarding-notifications");

  return (
    <div className="p-6 max-w-lg space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          Automation
        </h3>

        <div className="rounded-lg divide-y bg-[var(--t-bg-elevated)] border border-[var(--t-border)]">
          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--t-text-primary)]">Automatic port forwarding</p>
              <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">
                Detected listening ports are forwarded automatically during SSH sessions
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {autoForwardEnabled !== TOGGLE_DEFS["auto-forward"].default && (
                <ResetButton onReset={() => setAutoForwardEnabled(TOGGLE_DEFS["auto-forward"].default)} />
              )}
              {autoForwardEnabled !== TOGGLE_DEFS["auto-forward"].default && <DirtyDot />}
              <Toggle checked={autoForwardEnabled} onChange={setAutoForwardEnabled} />
            </div>
          </div>

          <div className="group flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p
                className="text-sm font-medium text-[var(--t-text-primary)]"
                style={{ opacity: autoForwardEnabled ? 1 : 0.45 }}
              >
                Forwarding notifications
              </p>
              <p
                className="text-xs mt-0.5 text-[var(--t-text-dim)]"
                style={{ opacity: autoForwardEnabled ? 1 : 0.45 }}
              >
                Show a notification each time a port is auto-forwarded
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {autoForwardNotificationsEnabled !== TOGGLE_DEFS["forwarding-notifications"].default && (
                <ResetButton onReset={() => setAutoForwardNotificationsEnabled(TOGGLE_DEFS["forwarding-notifications"].default)} />
              )}
              {autoForwardNotificationsEnabled !== TOGGLE_DEFS["forwarding-notifications"].default && <DirtyDot />}
              <Toggle
                checked={autoForwardNotificationsEnabled}
                onChange={setAutoForwardNotificationsEnabled}
                disabled={!autoForwardEnabled}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
