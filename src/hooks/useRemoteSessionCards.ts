import { useState } from "react";
import { useCrossDeviceSessionsStore } from "@/stores/crossDeviceSessionsStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { getJoinableSessions, joinRemoteSession, killRemoteSession } from "@/services/crossDeviceSessions";
import type { RemoteSession } from "@/stores/liveSessionManifestCore";
import { usePendingKills } from "@/hooks/usePendingKills";

export const KILL_WINDOW_MS = 5000;

export type RemoteCardState = "idle" | "pending" | "committing" | "failed";

const without = (set: Set<string>, id: string) => {
  const next = new Set(set);
  next.delete(id);
  return next;
};

/** Sessions open on other devices, with join and an undoable kill, for the desktop and mobile strips. */
export function useRemoteSessionCards(onJoin?: () => void) {
  const [enabled] = useToggle("cross-device-sessions");
  useCrossDeviceSessionsStore((s) => s.manifests);
  useSessionStore((s) => s.sessions);
  useConnectionStore((s) => s.connections);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState<Set<string>>(new Set());

  const commitKill = (sessionId: string) => {
    const target = getJoinableSessions().find((s) => s.sessionId === sessionId);
    if (!target) return;
    setCommitting((prev) => new Set(prev).add(sessionId));
    void killRemoteSession(target).then((res) => {
      setCommitting((prev) => without(prev, sessionId));
      if (!res.ok) setFailedIds((prev) => new Set(prev).add(sessionId));
    });
  };
  const { pending, start, cancel } = usePendingKills(commitKill, KILL_WINDOW_MS);
  const dismiss = (id: string) => setFailedIds((prev) => without(prev, id));

  return {
    sessions: enabled ? getJoinableSessions() : [],
    joiningId,
    stateOf: (id: string): RemoteCardState =>
      pending.has(id) ? "pending" : committing.has(id) ? "committing" : failedIds.has(id) ? "failed" : "idle",
    join: (session: RemoteSession) => {
      if (joiningId) return;
      setJoiningId(session.sessionId);
      onJoin?.();
      void joinRemoteSession(session).finally(() => setJoiningId(null));
    },
    kill: (id: string) => {
      dismiss(id);
      start(id);
    },
    undo: cancel,
    dismiss,
  };
}
