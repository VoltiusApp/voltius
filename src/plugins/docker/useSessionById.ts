import { useEffect, useState } from "react";
import type { PluginAPI, PluginSession } from "@/plugins/api";

/** Live session lookup by id (not necessarily the active one) — the mobile
 *  screen is pushed for a specific session, not always the foreground tab. */
export function useSessionById(api: PluginAPI, sessionId: string): PluginSession | null {
  const [session, setSession] = useState<PluginSession | null>(
    () => api.sessions.list().find((s) => s.id === sessionId) ?? null,
  );

  useEffect(() => {
    setSession(api.sessions.list().find((s) => s.id === sessionId) ?? null);

    const offConnected = api.sessions.onConnected((s) => {
      if (s.id === sessionId) setSession(s);
    });
    const offDisconnected = api.sessions.onDisconnected((s) => {
      if (s.id === sessionId) setSession({ ...s, status: "disconnected" });
    });

    return () => {
      offConnected();
      offDisconnected();
    };
  }, [api, sessionId]);

  return session;
}
