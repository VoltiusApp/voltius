import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { holdsControl } from "@/utils/multiplayerControl";
import { AvatarOverflow } from "@/components/shared/AvatarStack";
import { PresenceAvatar } from "@/components/shared/PresenceAvatar";
import { StatusDot } from "@/components/shared/StatusDot";
import { avatarLabel, usePeerResolver } from "@/services/peerName";
import { closeSessionTabs } from "@/services/closeSession";
import { useDismissBlockedReason } from "@/hooks/useSessionLocked";
import { greyedTapProps } from "@/components/mobile/tapOrExplain";

const SIZES = {
  pointer: { avatars: 5, avatar: 24, people: "gap-1.5", person: "", button: "px-2 py-1 rounded-md text-xs", leave: "px-2 py-1 rounded-md text-xs", icon: 12 },
  touch: {
    avatars: 3, avatar: 26, people: "-space-x-2", person: "ring-2 ring-(--t-bg-terminal)",
    button: "h-9 px-3 rounded-lg text-[13px]", leave: "h-9 w-9 justify-center rounded-lg", icon: 15,
  },
};

interface MultiplayerBarProps {
  localSessionId: string;
  touch?: boolean;
}

export function MultiplayerBar({ localSessionId, touch }: MultiplayerBarProps) {
  const peer = usePeerResolver();
  const { t } = useTranslation();
  const mpState = useTeamSessionStore((s) => s.connections[localSessionId]);
  const requestControl = useTeamSessionStore((s) => s.requestControl);
  const grantControl = useTeamSessionStore((s) => s.grantControl);
  const revokeControl = useTeamSessionStore((s) => s.revokeControl);
  const stopSharing = useTeamSessionStore((s) => s.stopSharing);
  const leaveBlockedReason = useDismissBlockedReason(localSessionId);

  if (!mpState) return null;

  const size = SIZES[touch ? "touch" : "pointer"];

  const isHost = mpState.role === "host";
  const myUserId = mpState.myUserId;
  const iControlHolder = holdsControl(mpState);
  const hasPendingRequest = mpState.controlRequester !== null && mpState.controlRequester !== myUserId;

  const handleStopOrLeave = async () => {
    if (isHost) {
      await stopSharing(localSessionId);
      // keep the terminal tab — only sharing state is cleared
    } else {
      closeSessionTabs([localSessionId]);
    }
  };

  return (
    <div
      data-multiplayer-bar
      className={`flex items-center gap-2 px-3 shrink-0 ${touch ? "py-2" : "py-1.5"}`}
      style={{
        background: "var(--t-bg-terminal)",
        borderTop: "1px solid var(--t-border)",
      }}
    >
      {/* Live indicator */}
      <div className="flex items-center gap-1.5 mr-1 whitespace-nowrap">
        {mpState.ended ? (
          <>
            <StatusDot tone="error" />
            <span className="text-xs font-semibold" style={{ color: "var(--t-status-error)" }}>
              {mpState.keyWait === "failed" ? t("terminal.multiplayerBar.keyFailed") : t("terminal.multiplayerBar.ended")}
            </span>
          </>
        ) : (
          <>
            <StatusDot tone="accent" motion="pulse" />
            <span className="text-xs font-semibold" style={{ color: "var(--t-accent)" }}>
              {isHost
                ? t("terminal.multiplayerBar.sharing")
                : mpState.keyWait === "waiting"
                  ? t("terminal.multiplayerBar.waitingForKey")
                  : iControlHolder
                    ? t("terminal.multiplayerBar.youHaveControl")
                    : t("terminal.multiplayerBar.watching")}
            </span>
          </>
        )}
      </div>

      {/* Participants */}
      <div className={`flex items-center flex-1 ${size.people}`}>
        {mpState.participants.slice(0, size.avatars).map((p) => {
          const who = peer(p.user_id, { fallbackHandle: p.handle });
          return (
            <PresenceAvatar
              key={p.user_id}
              handle={avatarLabel(who)}
              size={size.avatar}
              hasControl={p.user_id === mpState.controlHolder}
              className={`${size.person}${p.user_id === mpState.controlHolder ? " z-10" : ""}`}
            />
          );
        })}
        <AvatarOverflow
          count={mpState.participants.length - size.avatars}
          size={size.avatar}
          ringColor="var(--t-bg-terminal)"
          overlap={false}
        />
      </div>

      {/* Control actions — hidden when session has ended */}
      {!mpState.ended && !isHost && !iControlHolder && mpState.controlRequester !== myUserId && (
        <button
          data-multiplayer-request-control
          className={`shrink-0 flex items-center gap-1.5 whitespace-nowrap transition-colors ${size.button}`}
          style={{
            background: "var(--t-bg-elevated)",
            color: "var(--t-text-secondary)",
            border: "1px solid var(--t-border)",
          }}
          onClick={() => requestControl(localSessionId)}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)")}
        >
          <Icon icon="lucide:mouse-pointer-click" width={size.icon} />
          {t("terminal.multiplayerBar.requestControl")}
        </button>
      )}

      {!mpState.ended && !isHost && !iControlHolder && mpState.controlRequester === myUserId && (
        <span
          className={`min-w-0 flex items-center gap-1.5 ${size.button}`}
          style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-dim)" }}
        >
          <Icon icon="lucide:hourglass" width={size.icon} className="shrink-0" />
          <span className="truncate">{t("terminal.multiplayerBar.requestPending")}</span>
        </span>
      )}

      {/* Host: pending control request */}
      {!mpState.ended && isHost && hasPendingRequest && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: "var(--t-text-secondary)" }}>
            {t("terminal.multiplayerBar.controlRequested")}
          </span>
          <button
            className="px-2 py-0.5 rounded-sm text-xs font-medium transition-colors"
            style={{ background: "var(--t-accent)", color: "var(--t-on-accent)" }}
            onClick={() => grantControl(localSessionId, mpState.controlRequester!)}
          >
            {t("terminal.multiplayerBar.grant")}
          </button>
          <button
            className="px-2 py-0.5 rounded-sm text-xs font-medium transition-colors"
            style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-secondary)", border: "1px solid var(--t-border)" }}
            onClick={() => revokeControl(localSessionId)}
          >
            {t("terminal.multiplayerBar.deny")}
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
          {t("terminal.multiplayerBar.revoke")}
        </button>
      )}

      {/* Stop / Leave */}
      <button
        data-multiplayer-leave
        className={`shrink-0 flex items-center gap-1.5 whitespace-nowrap transition-colors ml-1 disabled:opacity-40 disabled:pointer-events-none aria-disabled:opacity-40 ${size.leave}`}
        style={{
          color: "var(--t-text-dim)",
        }}
        {...(touch
          ? greyedTapProps(isHost ? null : leaveBlockedReason, () => void handleStopOrLeave())
          : { onClick: () => void handleStopOrLeave(), disabled: !isHost && !!leaveBlockedReason })}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-status-error)";
          (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--t-status-error) 10%, transparent)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }}
        title={isHost ? t("terminal.multiplayerBar.stopSharingTitle") : leaveBlockedReason ?? t("terminal.multiplayerBar.leaveSessionTitle")}
        aria-label={touch ? (isHost ? t("terminal.multiplayerBar.stopSharingTitle") : t("terminal.multiplayerBar.leaveSessionTitle")) : undefined}
      >
        <Icon icon={isHost ? "lucide:circle-stop" : "lucide:log-out"} width={size.icon + 1} />
        {!touch && (isHost ? t("terminal.multiplayerBar.stop") : t("terminal.multiplayerBar.leave"))}
      </button>
    </div>
  );
}
