import { useEffect } from "react";
import { useHostPingStore } from "@/stores/hostPingStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSessionStore } from "@/stores/sessionStore";
import { buildPingTargets } from "@/services/ping/pingTargets";
import { probeTarget } from "@/services/ping/probe";
import { TICK_MS, selectDue } from "@/services/ping/schedule";

export function useHostPingPolling() {
  const [enabled] = useToggle("reachability");
  const clearStatuses = useHostPingStore((s) => s.clearStatuses);

  useEffect(() => {
    if (!enabled) {
      clearStatuses();
      return;
    }

    let cancelled = false;
    let dueAt: Record<string, number> = {};
    const inFlight = new Set<string>();

    // Stores are read through getState() rather than subscribed to: a write to
    // the connection store must not restart the schedule or trigger a probe.
    const tick = () => {
      const { connections, teamConnections } = useConnectionStore.getState();
      const { sessions } = useSessionStore.getState();
      const targets = buildPingTargets(
        [...connections, ...Object.values(teamConnections).flat()],
        sessions,
      );

      const { pollIntervalMs, activePollIntervalMs, setStatus } = useHostPingStore.getState();
      const selected = selectDue(targets, dueAt, Date.now(), activePollIntervalMs, pollIntervalMs);
      dueAt = selected.dueAt;

      for (const target of selected.due) {
        if (inFlight.has(target.key)) continue;
        inFlight.add(target.key);
        void probeTarget(target).then(({ status, latencyMs }) => {
          inFlight.delete(target.key);
          if (cancelled) return;
          for (const id of target.connectionIds) setStatus(id, status, latencyMs);
        });
      }
    };

    const interval = setInterval(tick, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, clearStatuses]);
}
