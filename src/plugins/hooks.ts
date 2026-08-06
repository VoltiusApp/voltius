import { useEffect, useState } from "react";
import type { PluginAPI, PluginSession } from "@/plugins/api";

/** Re-renders the caller whenever the host's active locale changes, so `t()`
 *  calls made during that render resolve against the new locale. */
export function useT(api: PluginAPI): PluginAPI["i18n"]["t"] {
  const [, setLocale] = useState(() => api.i18n.getLocale());
  useEffect(() => api.i18n.onLocaleChange(setLocale), [api]);
  return api.i18n.t;
}

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
