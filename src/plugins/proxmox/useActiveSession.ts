import { useEffect, useState } from "react";
import type { PluginSession } from "@/plugins/api";
import { getProxmoxApi } from "./runtime";

/** The session backing the active terminal tab, kept live via the sessions
 *  lifecycle events (no host store import available to an external bundle). */
export function useActiveSession(): PluginSession | null {
  const [session, setSession] = useState<PluginSession | null>(() => getProxmoxApi()?.sessions.getActive() ?? null);

  useEffect(() => {
    const api = getProxmoxApi();
    if (!api) return;
    setSession(api.sessions.getActive());

    const offActivated = api.sessions.onActivated((s) => setSession(s));
    const offConnected = api.sessions.onConnected((s) => {
      setSession((cur) => (cur && cur.id === s.id ? s : cur));
    });
    const offDisconnected = api.sessions.onDisconnected((s) => {
      setSession((cur) => (cur && cur.id === s.id ? { ...s, status: "disconnected" } : cur));
    });

    return () => {
      offActivated();
      offConnected();
      offDisconnected();
    };
  }, []);

  return session;
}
