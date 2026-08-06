import { useEffect, useMemo, useState } from "react";
import type { PluginConnection, PluginSession } from "@/plugins/api";
import { getAgentDeps } from "../state/agentStore";
import { resolveObjectRef, type ObjectRef } from "../state/objectRefs";

export interface ObjectRefResolver {
  resolve: (id: string) => ObjectRef | null;
  knownIds: Set<string>;
  loading: boolean;
}

/**
 * Resolves the ids that appear in transcript rows. Mirrors useConnectionLabels
 * for connections, and additionally maps a SESSION id to the connection it runs
 * on — `run_command`/`read_terminal` address a session, so without this every
 * such row renders a bare UUID.
 *
 * With no plugin API nothing ever arrives, so it settles immediately to empty.
 */
export function useObjectRefs(): ObjectRefResolver {
  const [connections, setConnections] = useState<PluginConnection[]>([]);
  const [sessions, setSessions] = useState<PluginSession[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const api = getAgentDeps()?.api;
    if (!api) { setLoaded(true); return; }
    let cancelled = false;
    api.connections
      .list()
      .then((list) => { if (!cancelled) { setConnections(list); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    // A connection created while the drawer is open would otherwise never
    // resolve — its id would render raw in every card for the rest of the
    // session, since the list was fetched once on mount.
    const unsubscribe = api.connections.subscribe((list) => { if (!cancelled) setConnections(list); });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  useEffect(() => {
    const api = getAgentDeps()?.api;
    if (!api) return;
    const sync = () => setSessions(api.sessions.list());
    sync();
    const offs = [api.sessions.onConnected(sync), api.sessions.onDisconnected(sync)];
    return () => offs.forEach((off) => off());
  }, []);

  const sessionConnectionId = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) if (s.connectionId) map.set(s.id, s.connectionId);
    return map;
  }, [sessions]);

  const knownIds = useMemo(
    () => new Set([...connections.map((c) => c.id), ...sessionConnectionId.keys()]),
    [connections, sessionConnectionId],
  );

  const resolve = (id: string) => {
    const direct = resolveObjectRef(id, connections);
    if (direct) return direct;
    const connectionId = sessionConnectionId.get(id);
    return connectionId ? resolveObjectRef(connectionId, connections) : null;
  };

  return { resolve, knownIds, loading: !loaded };
}
