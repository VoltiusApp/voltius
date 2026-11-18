import { useMemo } from "react";
import { useLayoutStore } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { sessionsPinnedFirst } from "@/services/tabLock";
import type { TerminalSession } from "@/types";

export function mobileSessions(sessions: TerminalSession[]): TerminalSession[] {
  return sessionsPinnedFirst(sessions.filter((s) => s.type !== "multiplayer"));
}

export function useMobileSessions(): TerminalSession[] {
  const sessions = useSessionStore((s) => s.sessions);
  const pinnedKeys = useLayoutStore((s) => s.pinnedKeys);
  return useMemo(() => mobileSessions(sessions), [sessions, pinnedKeys]);
}
