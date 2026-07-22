import { useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useCrossDeviceSessionsStore } from "@/stores/crossDeviceSessionsStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { getJoinableSessions, joinRemoteSession } from "@/services/crossDeviceSessions";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { BaseCard } from "@/components/shared/BaseCard";

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
  // Subscribed so the derived list recomputes when its inputs change.
  useCrossDeviceSessionsStore((s) => s.manifests);
  useSessionStore((s) => s.sessions);
  useConnectionStore((s) => s.connections);
  const [joiningId, setJoiningId] = useState<string | null>(null);

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
        {joinable.map((a) => (
          <BaseCard
            key={a.sessionId}
            glass
            onClick={() => {
              if (joiningId) return;
              setJoiningId(a.sessionId);
              void joinRemoteSession(a).finally(() => setJoiningId(null));
            }}
            className="shrink-0"
            style={{ minWidth: 220, maxWidth: 280 }}
          >
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
          </BaseCard>
        ))}
      </div>
    </div>
  );
}
