import { useState } from "react";
import { Icon } from "@iconify/react";
import { useCrossDeviceSessionsStore } from "@/stores/crossDeviceSessionsStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { getJoinableSessions, joinRemoteSession } from "@/services/crossDeviceSessions";
import { BaseCard } from "@/components/shared/BaseCard";

function relativeAge(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function RemoteDeviceSessions() {
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
          Live on other devices
        </p>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {joinable.map((a) => (
          <BaseCard
            key={a.sessionId}
            onClick={() => {
              if (joiningId) return;
              setJoiningId(a.sessionId);
              void joinRemoteSession(a).finally(() => setJoiningId(null));
            }}
            className="shrink-0"
            style={{ minWidth: 220, maxWidth: 280 }}
          >
            <div className="flex-1 min-w-0 self-start flex items-start gap-2">
              <div
                className="flex items-center justify-center shrink-0 select-none text-white"
                style={{ width: "2rem", height: "2rem", borderRadius: "8px", background: "color-mix(in srgb, var(--t-accent) 80%, #000)" }}
              >
                <Icon icon={joiningId === a.sessionId ? "lucide:loader-2" : "lucide:monitor-smartphone"} width={15} className={joiningId === a.sessionId ? "animate-spin" : undefined} />
              </div>

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
