import { useEffect, useState } from "react";
import { getPfState, onPfStateChanged, type PfSessionState } from "@/services/portForwardingTunnels";

/** Live port-forwarding state per session: fetched once, then kept current by
 *  `pf-state-changed`. Sessions dropped from `sessionIds` drop out of the map.
 *
 *  Everything one run of the effect started dies with it: a fetch that resolves
 *  after the ids changed (tab A → B) must not paint A's tunnels, and a listener
 *  whose `listen` resolves after cleanup is unregistered rather than leaked. */
export function usePfStates(sessionIds: readonly string[]): Map<string, PfSessionState> {
  const key = sessionIds.join(",");
  const [states, setStates] = useState<Map<string, PfSessionState>>(() => new Map());

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    let cancelled = false;
    // Sessions an event already reported on — a fetch answered later is older.
    const fresh = new Set<string>();
    const put = (sessionId: string, state: PfSessionState) => {
      if (!cancelled) setStates((prev) => new Map(prev).set(sessionId, state));
    };

    setStates((prev) => {
      const next = new Map([...prev].filter(([id]) => ids.includes(id)));
      return next.size === prev.size ? prev : next;
    });

    const unlisten = onPfStateChanged((sessionId, state) => {
      if (!ids.includes(sessionId)) return;
      fresh.add(sessionId);
      put(sessionId, state);
    });
    for (const sessionId of ids) {
      getPfState(sessionId)
        .then((state) => { if (!fresh.has(sessionId)) put(sessionId, state); })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn());
    };
  }, [key]);

  return states;
}

/** `usePfStates` for one session; null (not an SSH session) tracks nothing. */
export function usePfState(sessionId: string | null): PfSessionState | undefined {
  return usePfStates(sessionId ? [sessionId] : []).get(sessionId ?? "");
}
