import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useTeamSessionStore as useMpStore } from "@/stores/teamSessionStore";
import { getCurrentUserEmail } from "@/services/account";
import { useUIStore } from "@/stores/uiStore";

export function TeamSessions() {
  const { activeSessions, fetchActiveSessions, joinSession } = useTeamSessionStore();
  const setActive = useSessionStore((s) => s.setActive);
  const setActiveNav = useUIStore((s) => s.setActiveNav);

  const [showJoinModal, setShowJoinModal] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Poll for active sessions every 6 seconds
  useEffect(() => {
    fetchActiveSessions().catch(() => {});
    const interval = setInterval(() => {
      fetchActiveSessions().catch(() => {});
    }, 6000);
    return () => clearInterval(interval);
  }, [fetchActiveSessions]);

  useEffect(() => {
    if (showJoinModal) {
      setInviteCode("");
      setJoinError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [showJoinModal]);

  // Determine which sessions I'm already in
  const myMpSessionIds = new Set(
    Object.values(useMpStore.getState().connections).map((c) => c.multiplayerSessionId),
  );

  const doJoinSession = async (sessionId: string, inviteToken?: string) => {
    const displayName = (await getCurrentUserEmail()) ?? "Me";
    const localSessionId = await joinSession(
      sessionId,
      displayName,
      () => {}, // onControlUpdate — handled by MultiplayerBar
      inviteToken,
    );

    useSessionStore.setState((s) => ({
      sessions: [
        ...s.sessions,
        {
          id: localSessionId,
          connectionId: sessionId,
          connectionName: activeSessions.find((a) => a.id === sessionId)?.connection_name ?? "Shared Terminal",
          status: "connected" as const,
          type: "multiplayer" as any,
        },
      ],
      activeSessionId: localSessionId,
    }));
    setActiveNav("terminal" as any);
  };

  const handleJoinCard = async (session: (typeof activeSessions)[0]) => {
    if (myMpSessionIds.has(session.id)) {
      const localId = Object.entries(useMpStore.getState().connections).find(
        ([, v]) => v.multiplayerSessionId === session.id,
      )?.[0];
      if (localId) setActive(localId);
      return;
    }
    try {
      await doJoinSession(session.id);
    } catch (err) {
      console.error("Failed to join session:", err);
    }
  };

  const handleJoinByCode = async () => {
    const code = inviteCode.trim();
    if (!code) return;

    // Expected format: sessionId:inviteToken  (both UUIDs / tokens)
    const colonIdx = code.indexOf(":");
    if (colonIdx === -1) {
      setJoinError("Invalid code — expected format: sessionId:token");
      return;
    }

    const sessionId = code.slice(0, colonIdx);
    const token = code.slice(colonIdx + 1);

    if (!sessionId || !token) {
      setJoinError("Invalid code — expected format: sessionId:token");
      return;
    }

    setJoinLoading(true);
    setJoinError(null);
    try {
      await doJoinSession(sessionId, token);
      setShowJoinModal(false);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Failed to join session");
    } finally {
      setJoinLoading(false);
    }
  };

  if (activeSessions.length === 0 && !showJoinModal) {
    // Show minimal "Join by code" entry point even when no public sessions visible
    return (
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">
            Team Sessions
          </p>
          <button
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
            style={{ color: "var(--t-text-dim)", border: "1px solid var(--t-border)" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)")}
            onClick={() => setShowJoinModal(true)}
          >
            <Icon icon="lucide:link" width={11} />
            Join by code
          </button>
        </div>
        {showJoinModal && <JoinByCodeModal />}
      </div>
    );
  }

  function JoinByCodeModal() {
    return (
      <div
        className="mb-3 p-3 rounded-xl"
        style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}
      >
        <p className="text-xs font-medium mb-2" style={{ color: "var(--t-text-secondary)" }}>
          Paste an invite code to join a private session:
        </p>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={inviteCode}
            onChange={(e) => { setInviteCode(e.target.value); setJoinError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") void handleJoinByCode(); if (e.key === "Escape") setShowJoinModal(false); }}
            placeholder="sessionId:token"
            className="flex-1 text-xs px-2.5 py-1.5 rounded-lg outline-none"
            style={{
              background: "var(--t-bg-elevated)",
              border: "1px solid var(--t-border)",
              color: "var(--t-text-primary)",
              fontFamily: "monospace",
            }}
          />
          <button
            disabled={joinLoading || !inviteCode.trim()}
            onClick={() => void handleJoinByCode()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity disabled:opacity-50"
            style={{ background: "var(--t-accent)", color: "white" }}
          >
            {joinLoading
              ? <Icon icon="lucide:loader-2" width={12} className="animate-spin" />
              : <Icon icon="lucide:log-in" width={12} />}
            Join
          </button>
          <button
            onClick={() => setShowJoinModal(false)}
            className="px-2 py-1.5 rounded-lg text-xs transition-opacity"
            style={{ color: "var(--t-text-dim)" }}
          >
            <Icon icon="lucide:x" width={13} />
          </button>
        </div>
        {joinError && (
          <p className="mt-1.5 text-[11px]" style={{ color: "#f87171" }}>{joinError}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">
          Team Sessions
        </p>
        <span
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
          style={{
            background: "color-mix(in srgb, var(--t-accent) 15%, transparent)",
            color: "var(--t-accent)",
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: "var(--t-accent)" }}
          />
          LIVE
        </span>
        <button
          className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
          style={{ color: "var(--t-text-dim)", border: "1px solid var(--t-border)" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)")}
          onClick={() => setShowJoinModal((v) => !v)}
        >
          <Icon icon="lucide:link" width={11} />
          Join by code
        </button>
      </div>

      {showJoinModal && <JoinByCodeModal />}

      <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {activeSessions.map((session) => {
          const alreadyIn = myMpSessionIds.has(session.id);
          return (
            <button
              key={session.id}
              onClick={() => void handleJoinCard(session)}
              className="flex-shrink-0 flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-left"
              style={{
                background: "var(--t-bg-card)",
                border: alreadyIn
                  ? "1.5px solid var(--t-accent)"
                  : "1.5px solid var(--t-border)",
                minWidth: 200,
                maxWidth: 260,
              }}
              onMouseEnter={(e) => {
                if (!alreadyIn)
                  (e.currentTarget as HTMLButtonElement).style.borderColor =
                    "var(--t-border-hover)";
              }}
              onMouseLeave={(e) => {
                if (!alreadyIn)
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)";
              }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "var(--t-bg-card-avatar)" }}
              >
                <Icon
                  icon="lucide:terminal"
                  width={15}
                  style={{ color: alreadyIn ? "var(--t-accent)" : "var(--t-text-muted)" }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-medium truncate"
                  style={{ color: "var(--t-text-primary)" }}
                >
                  {session.connection_name}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--t-text-dim)" }}>
                  {session.participant_count} participant{session.participant_count !== 1 ? "s" : ""}
                  {alreadyIn ? " · Joined" : ""}
                </p>
              </div>
              {!alreadyIn && (
                <Icon
                  icon="lucide:log-in"
                  width={14}
                  style={{ color: "var(--t-text-dim)", flexShrink: 0 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
