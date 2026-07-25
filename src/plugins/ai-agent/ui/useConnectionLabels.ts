import { useEffect, useState } from "react";
import type { PluginConnection } from "@/plugins/api";
import { getAgentDeps } from "../state/agentStore";
import { resolveScopeLabel, type ScopeLabel } from "../state/connectionLabels";

/**
 * Loads the connection list once per mount and returns a scope→label
 * resolver. Connections are read through the plugin API, so an inactive
 * plugin resolves everything as `deleted` rather than throwing.
 */
export function useConnectionLabels(): (scope: string) => ScopeLabel {
  const [connections, setConnections] = useState<PluginConnection[]>([]);

  useEffect(() => {
    const api = getAgentDeps()?.api;
    if (!api) return;
    let cancelled = false;
    api.connections
      .list()
      .then((list) => { if (!cancelled) setConnections(list); })
      .catch(() => { /* leave empty: scopes resolve as deleted, never blank */ });
    return () => { cancelled = true; };
  }, []);

  return (scope: string) => resolveScopeLabel(scope, connections);
}
