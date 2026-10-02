import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { PluginSession } from "@/plugins/api";
import { EMPTY_HOST_METRICS, hostKey, type HostMetrics, type HostMetricsHub } from "./hostMetricsHub";

/** Live metrics for the session's host. Tabs of the same host share one stream and history.
 *  Shared by desktop MetricsPanel + mobile Metrics screen. */
export function useHostMetrics(
  hub: HostMetricsHub,
  session: PluginSession | undefined,
  opts: { paused?: boolean; localUnsupported?: boolean } = {},
): HostMetrics {
  const streaming =
    !!session &&
    session.status === "connected" &&
    session.type !== "serial" &&
    !opts.localUnsupported &&
    !opts.paused;
  const key = streaming ? hostKey(session) : null;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const subscribe = useCallback(
    (listener: () => void) => (key && sessionRef.current ? hub.subscribe(sessionRef.current, listener) : () => {}),
    [hub, key],
  );
  const metrics = useSyncExternalStore(subscribe, () => (key ? hub.metrics(key) : EMPTY_HOST_METRICS));

  useEffect(() => {
    if (key && sessionRef.current) hub.ensureLive(sessionRef.current);
  }, [hub, key, session?.id]);

  return metrics;
}
