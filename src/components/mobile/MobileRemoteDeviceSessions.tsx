import { useState } from "react";
import { Icon } from "@iconify/react";
import { useCrossDeviceSessionsStore } from "@/stores/crossDeviceSessionsStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { getJoinableSessions, joinRemoteSession } from "@/services/crossDeviceSessions";

function relativeAge(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Mobile "Live on other devices" strip — phone-native styling over the same pure
 * getJoinableSessions()/joinRemoteSession() as the desktop RemoteDeviceSessions card.
 * On join, also switch the mobile terminal tab (joinRemoteSession's desktop setActiveNav
 * is inert in the mobile shell). */
export default function MobileRemoteDeviceSessions() {
  const [enabled] = useToggle("cross-device-sessions");
  // Subscribed so the derived list recomputes when its inputs change.
  useCrossDeviceSessionsStore((s) => s.manifests);
  useSessionStore((s) => s.sessions);
  useConnectionStore((s) => s.connections);
  const setTab = useMobileNavStore((s) => s.setTab);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const joinable = enabled ? getJoinableSessions() : [];
  if (joinable.length === 0) return null;

  return (
    <div className="px-3 pt-2 pb-1" data-mobile-remote-sessions>
      <p className="text-[11px] font-bold uppercase tracking-widest text-(--t-text-dim) mb-2 px-1">
        Live on other devices
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {joinable.map((a) => (
          <button
            key={a.sessionId}
            data-mobile-remote-session={a.sessionId}
            onClick={() => {
              if (joiningId) return;
              setJoiningId(a.sessionId);
              setTab("terminal");
              void joinRemoteSession(a).finally(() => setJoiningId(null));
            }}
            className="shrink-0 flex items-start gap-2 rounded-xl px-3 py-2.5 text-left active:opacity-80"
            style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)", minWidth: 200, maxWidth: 260 }}
          >
            <span
              className="shrink-0 grid place-items-center rounded-md"
              style={{ width: 30, height: 30, background: "var(--t-accent)" }}
            >
              <Icon
                icon={joiningId === a.sessionId ? "lucide:loader-2" : "lucide:monitor-smartphone"}
                width={16}
                className={joiningId === a.sessionId ? "text-white animate-spin" : "text-white"}
              />
            </span>
            <span className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-semibold truncate text-(--t-text-primary)">{a.connectionName}</span>
              <span className="text-[11px] truncate text-(--t-text-dim)">
                {a.deviceName} · {relativeAge(a.openedAt)}
              </span>
              {a.cwd && <span className="text-[11px] truncate text-(--t-text-dim)">{a.cwd}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
