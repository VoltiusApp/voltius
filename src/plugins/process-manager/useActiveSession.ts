import { useEffect, useState } from "react";
import type { PluginAPI, PluginSession } from "@/plugins/api";

/** The session backing the active terminal tab, kept live via the sessions
 *  lifecycle events (no host store import available to an external bundle). */
export function useActiveSession(api: PluginAPI): PluginSession | null {
  const [session, setSession] = useState<PluginSession | null>(() => api.sessions.getActive());

  useEffect(() => {
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
  }, [api]);

  return session;
}
