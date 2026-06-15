import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useUIStore } from "@/stores/uiStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { matchesSearch } from "@/utils/connectionFilter";
import { useIsAndroid } from "@/utils/platform";
import { getSnippetInjectionTargetIds, waitForConnectedSessionIds } from "@/components/shared/sessionPickerTargets";

export interface ShellOption {
  name: string;
  path: string;
}

export function useSnippetTargetPicker() {
  const sessions = useSessionStore((s) => s.sessions);
  const connections = useConnectionStore((s) => s.connections);
  const [search, setSearch] = useState("");
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(new Set());
  const [localShell, setLocalShell] = useState<string | null>(null);
  const [shells, setShells] = useState<ShellOption[]>([]);
  const isAndroid = useIsAndroid();

  useEffect(() => {
    invoke<ShellOption[]>("local_list_shells").then(setShells).catch(() => {});
  }, []);

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status === "connected" && s.type !== "multiplayer"),
    [sessions],
  );

  const filteredSessions = useMemo(
    () => !search
      ? activeSessions
      : activeSessions.filter((s) => s.connectionName.toLowerCase().includes(search.toLowerCase())),
    [activeSessions, search],
  );

  const filteredHosts = useMemo(
    () => connections
      .filter((c) => c.connection_type !== "serial")
      .filter((c) => matchesSearch(c, search)),
    [connections, search],
  );

  function toggleSession(id: string) {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleConnection(id: string) {
    setSelectedConnectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const totalSelected = selectedSessionIds.size + selectedConnectionIds.size + (localShell !== null ? 1 : 0);

  async function confirm(onResolved: (ids: string[]) => void): Promise<void> {
    const sessionIds = [...selectedSessionIds];
    const pickedConnections = connections.filter((c) => selectedConnectionIds.has(c.id));

    onResolved(sessionIds);

    const connectionSessionIds = pickedConnections.length > 0
      ? await useSessionStore.getState().connectMany(pickedConnections.map((conn) => conn.id)).catch(() => [])
      : [];

    const localSessionId = localShell !== null
      ? useSessionStore.getState().beginLocalSession(localShell || undefined)
      : null;

    const newSessionIds = localSessionId
      ? [...connectionSessionIds, localSessionId]
      : connectionSessionIds;

    const allSessionIds = getSnippetInjectionTargetIds(sessionIds, newSessionIds);

    if (allSessionIds.length > 0) {
      useUIStore.getState().setActiveNav("terminal");

      if (allSessionIds.length === 1) {
        useSessionStore.getState().setActive(allSessionIds[0]);
      } else {
        const layout = useLayoutStore.getState();
        layout.openSessions(allSessionIds);
        useSessionStore.getState().setActive(allSessionIds[0]);
      }
    }

    if (newSessionIds.length > 0) {
      void waitForConnectedSessionIds(
        newSessionIds,
        () => useSessionStore.getState().sessions,
        (listener) => useSessionStore.subscribe(listener),
      ).then(onResolved);
    }
  }

  return {
    search, setSearch, isAndroid, shells,
    activeSessions, filteredSessions, filteredHosts,
    selectedSessionIds, selectedConnectionIds, localShell, setLocalShell,
    toggleSession, toggleConnection, totalSelected, confirm,
  };
}
