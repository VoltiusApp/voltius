import { useEffect, useState } from "react";
import type { PluginConnection } from "@/plugins/api";
import { getAgentDeps } from "../state/agentStore";
import { resolveScopeLabel, type ScopeLabel } from "../state/connectionLabels";
import { UNKNOWN_SCOPE } from "../state/scopeDerivation";

/**
 * Loads the connection list once per mount and returns a scope→label
 * resolver. Until the load settles, a connection-id scope resolves as
 * `pending` (not `deleted`) so a valid grant never flashes as removed.
 * With no plugin API the list will never arrive, so that case settles
 * immediately to `deleted` — consistent with a failed load, and honest
 * since there is no active plugin to ever resolve the id against.
 */
export function useConnectionLabels(): (scope: string) => ScopeLabel {
  const [connections, setConnections] = useState<PluginConnection[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const api = getAgentDeps()?.api;
    if (!api) { setLoaded(true); return; }
    let cancelled = false;
    api.connections
      .list()
      .then((list) => { if (!cancelled) { setConnections(list); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); /* leave empty: scopes resolve as deleted, never blank */ });
    return () => { cancelled = true; };
  }, []);

  return (scope: string) => {
    if (!loaded && scope !== "local" && scope !== UNKNOWN_SCOPE) {
      return { kind: "pending", name: scope, detail: null };
    }
    return resolveScopeLabel(scope, connections);
  };
}
