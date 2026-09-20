import { useSyncExternalStore } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import type { TerminalSession } from "@/types";

const since = new Map<string, number>();
const listeners = new Set<() => void>();

function record(sessions: TerminalSession[]) {
  let changed = false;
  const live = new Set<string>();
  for (const session of sessions) {
    live.add(session.id);
    if (session.status === "connected") {
      if (!since.has(session.id)) { since.set(session.id, Date.now()); changed = true; }
    } else if (since.delete(session.id)) {
      changed = true;
    }
  }
  for (const id of [...since.keys()]) {
    if (!live.has(id)) { since.delete(id); changed = true; }
  }
  if (changed) listeners.forEach((listener) => listener());
}

record(useSessionStore.getState().sessions);
useSessionStore.subscribe((state) => record(state.sessions));

export function connectedSince(sessionId: string): number | null {
  return since.get(sessionId) ?? null;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useConnectedSince(sessionId: string | null): number | null {
  return useSyncExternalStore(subscribe, () => (sessionId ? connectedSince(sessionId) : null));
}
