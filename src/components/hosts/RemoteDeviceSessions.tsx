import { useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useCrossDeviceSessionsStore } from "@/stores/crossDeviceSessionsStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { getJoinableSessions, joinRemoteSession, killRemoteSession } from "@/services/crossDeviceSessions";
import { usePendingKills } from "@/hooks/usePendingKills";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { BaseCard } from "@/components/shared/BaseCard";

const KILL_WINDOW_MS = 5000;

function relativeAge(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return i18n.t("hosts.remoteSessions.justNow");
  if (mins < 60) return i18n.t("hosts.remoteSessions.minutesAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return i18n.t("hosts.remoteSessions.hoursAgo", { count: hours });
  return i18n.t("hosts.remoteSessions.daysAgo", { count: Math.floor(hours / 24) });
}

export function RemoteDeviceSessions() {
  const { t } = useTranslation();
  const [enabled] = useToggle("cross-device-sessions");
  useCrossDeviceSessionsStore((s) => s.manifests);
  useSessionStore((s) => s.sessions);
  useConnectionStore((s) => s.connections);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  const commitKill = (sessionId: string) => {
    const target = getJoinableSessions().find((s) => s.sessionId === sessionId);
    if (!target) return;
    void killRemoteSession(target).then((res) => {
      if (!res.ok) setFailedId(sessionId);
    });
  };
  const { pending, start, cancel } = usePendingKills(commitKill, KILL_WINDOW_MS);

  const joinable = enabled ? getJoinableSessions() : [];
  if (joinable.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
          {t("hosts.remoteSessions.title")}
        </p>
      </div>

      <div className="flex gap-3 overflow-x-auto p-8 -m-8" style={{ scrollbarWidth: "none" }}>
        {joinable.map((a) => {
          const isPending = pending.has(a.sessionId);
          const isFailed = failedId === a.sessionId;
          return (
            <BaseCard
              key={a.sessionId}
              glass
              onClick={
                isPending || isFailed
                  ? undefined
                  : (e) => {
                      // BaseCard's onContextMenu also invokes onClick (it doubles
                      // as "select" for right-click) when isSelected is falsy,
                      // which this list never sets. Without this guard, opening
                      // the Kill menu would also join the session being killed.
                      if (e.type !== "click") return;
                      if (joiningId) return;
                      setJoiningId(a.sessionId);
                      void joinRemoteSession(a).finally(() => setJoiningId(null));
                    }
              }
              contextMenuItems={
                isPending || isFailed
                  ? undefined
                  : [{ label: t("hosts.remoteSessions.kill"), icon: "lucide:trash-2", danger: true, onClick: () => { setFailedId(null); start(a.sessionId); } }]
              }
              className="shrink-0"
              style={{ minWidth: 220, maxWidth: 280 }}
            >
              {isPending ? (
                <div className="flex-1 min-w-0 self-stretch flex flex-col gap-2 opacity-70">
                  <p className="text-sm font-bold truncate text-(--t-text-bright)">{t("hosts.remoteSessions.killing")}</p>
                  <p className="text-[11px] truncate text-(--t-text-dim)">{a.connectionName}</p>
                  <div className="h-1 rounded-full overflow-hidden bg-(--t-bg-elevated)">
                    <div
                      className="h-full bg-(--t-status-error)"
                      style={{ animation: `voltius-kill-drain ${KILL_WINDOW_MS}ms linear forwards` }}
                    />
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); cancel(a.sessionId); }}
                    className="self-start text-[11px] font-semibold px-2 py-0.5 rounded-md bg-(--t-bg-elevated) hover:bg-(--t-bg-card-hover) text-(--t-text-bright)"
                  >
                    {t("hosts.remoteSessions.undo")}
                  </button>
                </div>
              ) : isFailed ? (
                <div className="flex-1 min-w-0 self-stretch flex flex-col gap-2">
                  <p className="text-[11px] text-(--t-status-error)">{t("hosts.remoteSessions.killFailed")}</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); setFailedId(null); }}
                    className="self-start text-[11px] font-semibold px-2 py-0.5 rounded-md bg-(--t-bg-elevated) hover:bg-(--t-bg-card-hover) text-(--t-text-bright)"
                  >
                    {t("hosts.remoteSessions.undo")}
                  </button>
                </div>
              ) : (
                <div className="flex-1 min-w-0 self-start flex items-start gap-2">
                  <AvatarTile
                    base="var(--t-accent)"
                    icon={joiningId === a.sessionId ? "lucide:loader-circle" : "lucide:monitor-smartphone"}
                    size={30}
                    radius={6}
                    className="text-white"
                    iconClassName={joiningId === a.sessionId ? "animate-spin" : undefined}
                  />
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <p className="text-sm font-bold truncate text-(--t-text-bright)">{a.connectionName}</p>
                    <p className="text-[11px] truncate text-(--t-text-dim)">
                      {a.deviceName} · active {relativeAge(a.openedAt)}
                    </p>
                    {a.cwd && <p className="text-[11px] truncate text-(--t-text-dim)">{a.cwd}</p>}
                  </div>
                </div>
              )}
            </BaseCard>
          );
        })}
      </div>
    </div>
  );
}
