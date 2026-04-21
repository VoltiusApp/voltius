import { useHostPingStore } from "@/stores/hostPingStore";
import { Toggle } from "@/components/shared/Toggle";

export default function HostsSection() {
  const enabled = useHostPingStore((s) => s.enabled);
  const setEnabled = useHostPingStore((s) => s.setEnabled);

  return (
    <div className="p-6 max-w-lg space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          Connectivity
        </h3>
        <div className="rounded-lg bg-[var(--t-bg-elevated)] border border-[var(--t-border)]">
          <div className="flex items-center justify-between px-4 py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--t-text-primary)]">Reachability check</p>
              <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">
                Probes the SSH port every 30 s and shows a green / red dot on each host card.
                Can be disabled per host in the host's settings.
              </p>
            </div>
            <Toggle checked={enabled} onChange={setEnabled} />
          </div>
        </div>
      </div>
    </div>
  );
}
