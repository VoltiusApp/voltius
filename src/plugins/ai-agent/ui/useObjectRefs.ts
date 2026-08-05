import { useEffect, useMemo, useState } from "react";
import type { PluginConnection } from "@/plugins/api";
import { getAgentDeps } from "../state/agentStore";
import { resolveObjectRef, type ObjectRef } from "../state/objectRefs";

export interface ObjectRefResolver {
  resolve: (id: string) => ObjectRef | null;
  knownIds: Set<string>;
  loading: boolean;
}

/**
 * Loads the connection list once per mount. Mirrors useConnectionLabels: with
 * no plugin API the list never arrives, so it settles immediately to empty.
 */
export function useObjectRefs(): ObjectRefResolver {
  const [connections, setConnections] = useState<PluginConnection[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const api = getAgentDeps()?.api;
    if (!api) { setLoaded(true); return; }
    let cancelled = false;
    api.connections
      .list()
      .then((list) => { if (!cancelled) { setConnections(list); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const knownIds = useMemo(() => new Set(connections.map((c) => c.id)), [connections]);

  return {
    resolve: (id: string) => resolveObjectRef(id, connections),
    knownIds,
    loading: !loaded,
  };
}
