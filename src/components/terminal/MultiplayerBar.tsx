import { Icon } from "@iconify/react";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { useSessionStore } from "@/stores/sessionStore";

interface MultiplayerBarProps {
  localSessionId: string;
}

export function MultiplayerBar({ localSessionId }: MultiplayerBarProps) {
  const mpState = useTeamSessionStore((s) => s.connections[localSessionId]);
  const requestControl = useTeamSessionStore((s) => s.requestControl);
  const grantControl = useTeamSessionStore((s) => s.grantControl);
  const revokeControl = useTeamSessionStore((s) => s.revokeControl);
  const stopSharing = useTeamSessionStore((s) => s.stopSharing);
  const leaveSession = useTeamSessionStore((s) => s.leaveSession);
  const removeSession = useSessionStore((s) => s.removeSession);

  if (!mpState) return null;

  const isHost = mpState.role === "host";
  const myUserId = mpState.myUserId;
  const iControlHolder = myUserId !== "" && mpState.controlHolder === myUserId;
  const hasPendingRequest = mpState.controlRequester !== null && mpState.controlRequester !== myUserId;

  const handleStopOrLeave = async () => {
    if (isHost) {
      await stopSharing(localSessionId);
      // keep the terminal tab — only sharing state is cleared
    } else {
      leaveSession(localSessionId);
      removeSession(localSessionId);
    }
  };

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 shrink-0"
      style={{
        background: "var(--t-bg-terminal)",
        borderTop: "1px solid var(--t-border)",
      }}
    >
      {/* Live indicator */}
      <div className="flex items-center gap-1.5 mr-1">
        {mpState.ended ? (
          <>
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: "var(--t-status-error)" }}
            />
            <span className="text-xs font-semibold" style={{ color: "var(--t-status-error)" }}>
              Ended
            </span>
          </>
        ) : (
          <>
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: "var(--t-accent)" }}
            />
            <span className="text-xs font-semibold" style={{ color: "var(--t-accent)" }}>
              {isHost ? "Sharing" : "Watching"}
            </span>
          </>
        )}
      </div>

      {/* Participants */}
      <div className="flex items-center gap-1 flex-1">
        {mpState.participants.slice(0, 5).map((p) => (
          <div
            key={p.user_id}
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
            style={{
              background:
                p.user_id === mpState.controlHolder
                  ? "var(--t-accent)"
                  : "var(--t-bg-card-avatar)",
              color:
                p.user_id === mpState.controlHolder
                  ? "white"
                  : "var(--t-text-muted)",
              border:
                p.user_id === mpState.controlHolder
                  ? "1.5px solid var(--t-accent)"
                  : "1.5px solid var(--t-border)",
            }}
            title={p.display_name}
          >
            {p.display_name.slice(0, 2).toUpperCase()}
          </div>
        ))}
        {mpState.participants.length > 5 && (
          <span className="text-xs" style={{ color: "var(--t-text-dim)" }}>
            +{mpState.participants.length - 5}
          </span>
        )}
      </div>

      {/* Control actions — hidden when session has ended */}
      {!mpState.ended && !isHost && !iControlHolder && (
        <button
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors"
          style={{
            background: "var(--t-bg-elevated)",
            color: "var(--t-text-secondary)",
            border: "1px solid var(--t-border)",
          }}
          onClick={() => requestControl(localSessionId)}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)")}
        >
          <Icon icon="lucide:mouse-pointer-click" width={12} />
          Request Control
        </button>
      )}

      {!mpState.ended && iControlHolder && !isHost && (
        <span
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs"
          style={{
            background: "color-mix(in srgb, var(--t-accent) 12%, transparent)",
            color: "var(--t-accent)",
            border: "1px solid color-mix(in srgb, var(--t-accent) 30%, transparent)",
          }}
        >
          <Icon icon="lucide:pencil" width={12} />
          You have control
        </span>
      )}

      {/* Host: pending control request */}
      {!mpState.ended && isHost && hasPendingRequest && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: "var(--t-text-secondary)" }}>
            Control requested
          </span>
          <button
            className="px-2 py-0.5 rounded text-xs font-medium transition-colors"
            style={{ background: "var(--t-accent)", color: "white" }}
            onClick={() => grantControl(localSessionId, mpState.controlRequester!)}
          >
            Grant
          </button>
          <button
            className="px-2 py-0.5 rounded text-xs font-medium transition-colors"
            style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-secondary)", border: "1px solid var(--t-border)" }}
            onClick={() => revokeControl(localSessionId)}
          >
            Deny
          </button>
        </div>
      )}

      {/* Host: revoke control if someone else has it */}
      {!mpState.ended && isHost && !iControlHolder && mpState.controlHolder !== "" && (
        <button
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors"
          style={{
            background: "var(--t-bg-elevated)",
            color: "var(--t-text-secondary)",
            border: "1px solid var(--t-border)",
          }}
          onClick={() => revokeControl(localSessionId)}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--t-status-error)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)")}
        >
          <Icon icon="lucide:x" width={11} />
          Revoke
        </button>
      )}

      {/* Stop / Leave */}
      <button
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors ml-1"
        style={{
          color: "var(--t-text-dim)",
        }}
        onClick={() => void handleStopOrLeave()}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-status-error)";
          (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--t-status-error) 10%, transparent)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }}
        title={isHost ? "Stop sharing" : "Leave session"}
      >
        <Icon icon={isHost ? "lucide:stop-circle" : "lucide:log-out"} width={13} />
        {isHost ? "Stop" : "Leave"}
      </button>
    </div>
  );
}
