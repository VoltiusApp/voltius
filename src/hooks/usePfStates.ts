import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getPfState, onPfStateChanged, type PfSessionState } from "@/services/portForwardingTunnels";
import { useSessionStore } from "@/stores/sessionStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import type { TerminalSession } from "@/types";

let states = new Map<string, PfSessionState>();
const subscribers = new Set<() => void>();
/** Hooks tracking each session; its state is kept only while this is non-zero. */
const trackers = new Map<string, number>();
/** Bumped by every event and untrack, so a fetch answered after either is discarded. */
const versions = new Map<string, number>();
let listening = false;

function publish(next: Map<string, PfSessionState>) {
  states = next;
  subscribers.forEach((notify) => notify());
}

function bump(sessionId: string) {
  versions.set(sessionId, (versions.get(sessionId) ?? 0) + 1);
}

function fetchState(sessionId: string) {
  const version = versions.get(sessionId) ?? 0;
  getPfState(sessionId)
    .then((state) => {
      if (trackers.has(sessionId) && (versions.get(sessionId) ?? 0) === version) publish(new Map(states).set(sessionId, state));
    })
    .catch(() => {});
}

function listenOnce() {
  if (listening) return;
  listening = true;
  void onPfStateChanged((sessionId, state) => {
    if (!trackers.has(sessionId)) return;
    bump(sessionId);
    publish(new Map(states).set(sessionId, state));
  });
  // A reconnected session's tunnels are re-read, not left as they were before the drop.
  useSessionStore.subscribe((state, prev) => {
    for (const session of state.sessions) {
      if (!trackers.has(session.id) || session.status !== "connected") continue;
      if (prev.sessions.find((s) => s.id === session.id)?.status !== "connected") fetchState(session.id);
    }
  });
}

function track(sessionIds: string[]): () => void {
  listenOnce();
  for (const id of sessionIds) {
    const count = trackers.get(id) ?? 0;
    trackers.set(id, count + 1);
    if (count === 0 && !states.has(id)) fetchState(id);
  }
  return () => {
    for (const id of sessionIds) {
      const count = trackers.get(id)! - 1;
      if (count > 0) trackers.set(id, count);
      else trackers.delete(id);
    }
    // A hook whose ids changed re-tracks in the same commit; drop only what nobody picked back up.
    queueMicrotask(() => {
      const dropped = sessionIds.filter((id) => !trackers.has(id));
      dropped.forEach(bump);
      if (dropped.some((id) => states.has(id))) publish(new Map([...states].filter(([id]) => !dropped.includes(id))));
    });
  };
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  return () => { subscribers.delete(notify); };
}

/** Live port-forwarding state for each of `sessionIds`, shared by every caller through one listener. */
export function usePfStates(sessionIds: readonly string[]): Map<string, PfSessionState> {
  const key = sessionIds.join(",");
  useEffect(() => track(key ? key.split(",") : []), [key]);
  const all = useSyncExternalStore(subscribe, () => states);
  return useMemo(() => {
    const picked = new Map<string, PfSessionState>();
    for (const id of key ? key.split(",") : []) {
      const state = all.get(id);
      if (state) picked.set(id, state);
    }
    return picked;
  }, [all, key]);
}

/** `usePfStates` for one session; null tracks nothing. */
export function usePfState(sessionId: string | null): PfSessionState | undefined {
  return usePfStates(sessionId ? [sessionId] : []).get(sessionId ?? "");
}

/** Connected SSH sessions on hosts the user can reach, with their port-forwarding state. */
export function useConnectedSshPfStates(): { sessions: TerminalSession[]; pfStates: Map<string, PfSessionState> } {
  const allSessions = useSessionStore((s) => s.sessions);
  const connections = useAllConnections();
  const accessibleVaultIds = useAccessibleVaultIds();
  const sessions = useMemo(() => allSessions.filter((s) => {
    if (s.type !== "ssh" || s.status !== "connected") return false;
    const conn = connections.find((c) => c.id === s.connectionId);
    return !!conn && accessibleVaultIds.includes(conn.vault_id ?? "personal");
  }), [allSessions, connections, accessibleVaultIds]);
  return { sessions, pfStates: usePfStates(sessions.map((s) => s.id)) };
}
