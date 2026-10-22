import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { RemoteSession } from "@/stores/liveSessionManifestCore";
import { KILL_WINDOW_MS, type RemoteCardState } from "@/hooks/useRemoteSessionCards";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { sessionLabel } from "@/utils/sessionLabel";
import { formatRelative } from "@/utils/localeFormat";

const smallButton = "self-start text-[11px] font-semibold px-2 py-0.5 rounded-md bg-(--t-bg-elevated) hover:bg-(--t-bg-card-hover) text-(--t-text-bright)";

/** The inside of a "Live on other devices" card, shared by the desktop and mobile strips. */
export function RemoteSessionCardBody({ session: a, state, joining, onUndo, onDismiss }: {
  session: RemoteSession;
  state: RemoteCardState;
  joining: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  if (state === "pending" || state === "committing") {
    return (
      <div className="flex-1 min-w-0 self-stretch flex flex-col gap-1 opacity-70">
        <p className="text-sm font-bold truncate text-(--t-text-bright)">{t("hosts.remoteSessions.killing")}</p>
        <p className="text-[11px] truncate text-(--t-text-dim)">{sessionLabel(a)}</p>
        {state === "pending" ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full overflow-hidden bg-(--t-bg-elevated)">
              <div className="h-full bg-(--t-status-error)" style={{ animation: `voltius-kill-drain ${KILL_WINDOW_MS}ms linear forwards` }} />
            </div>
            <button data-remote-session-undo onClick={(e) => { e.stopPropagation(); onUndo(); }} className={smallButton}>
              {t("hosts.remoteSessions.undo")}
            </button>
          </div>
        ) : (
          <Icon icon="lucide:loader-circle" className="animate-spin text-(--t-text-dim)" width={16} height={16} />
        )}
      </div>
    );
  }
  if (state === "failed") {
    return (
      <div className="flex-1 min-w-0 self-stretch flex flex-col gap-2">
        <p className="text-[11px] truncate text-(--t-text-bright)">{sessionLabel(a)}</p>
        <p className="text-[11px] text-(--t-status-error)">{t("hosts.remoteSessions.killFailed")}</p>
        <button onClick={(e) => { e.stopPropagation(); onDismiss(); }} className={smallButton}>
          {t("hosts.remoteSessions.dismiss")}
        </button>
      </div>
    );
  }
  return (
    <div className="flex-1 min-w-0 self-start flex items-start gap-2">
      <AvatarTile
        base="var(--t-accent)"
        icon={joining ? "lucide:loader-circle" : "lucide:monitor-smartphone"}
        size={30}
        radius={6}
        className="text-white"
        iconClassName={joining ? "animate-spin" : undefined}
      />
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <p className="text-sm font-bold truncate text-(--t-text-bright)">{sessionLabel(a)}</p>
        <p className="text-[11px] truncate text-(--t-text-dim)">
          {t("hosts.remoteSessions.deviceActive", { device: a.deviceName || t("hosts.remoteSessions.unknownDevice"), age: formatRelative(a.openedAt) })}
        </p>
        {a.cwd && <p className="text-[11px] truncate text-(--t-text-dim)">{a.cwd}</p>}
      </div>
    </div>
  );
}
