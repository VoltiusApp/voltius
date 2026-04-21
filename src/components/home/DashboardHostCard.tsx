import { Icon } from "@iconify/react";
import type { Connection } from "@/types";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { useConnectionStore } from "@/stores/connectionStore";
import { useHostPingStore } from "@/stores/hostPingStore";

function displayName(c: Connection): string {
  return c.name?.trim() || `${c.username}@${c.host}`;
}

interface Props {
  connection: Connection;
  onConnect: (conn: Connection) => void;
}

export function DashboardHostCard({ connection, onConnect }: Props) {
  const pinConnection = useConnectionStore((s) => s.pinConnection);
  const isPinned = connection.pinned ?? false;
  const pingEnabled = useHostPingStore((s) => s.enabled);
  const pingStatus = useHostPingStore((s) => s.statuses[connection.id]);
  const showPingDot = pingEnabled && !connection.ping_disabled;

  return (
    <div
      className="group relative flex flex-col items-center gap-2 p-3 rounded-xl cursor-pointer transition-all shrink-0"
      style={{
        background: "var(--t-bg-card)",
        border: "1px solid var(--t-border)",
        width: "7.5rem",
      }}
      onClick={() => onConnect(connection)}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "var(--t-border-hover)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "var(--t-border)";
      }}
    >
      <button
        className={`absolute top-1.5 right-1.5 transition-opacity p-0.5 rounded ${isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        style={{ color: isPinned ? "var(--t-accent)" : "var(--t-text-dim)" }}
        onClick={(e) => {
          e.stopPropagation();
          pinConnection(connection.id, !isPinned).catch(() => {});
        }}
        title={isPinned ? "Unpin" : "Pin"}
      >
        <Icon icon={isPinned ? "lucide:pin" : "lucide:pin-off"} width={11} />
      </button>
      <div className="relative">
        <ConnectionAvatar connection={connection} size={36} />
        {showPingDot && (
          <span className="absolute bottom-0 right-0">
            {pingStatus === "up" && (
              <span
                className="absolute inset-0 rounded-full animate-ping-slow"
                style={{ background: "var(--t-status-connected)" }}
              />
            )}
            <span
              className="relative block rounded-full border-2 border-[var(--t-bg-card)]"
              style={{
                width: 10,
                height: 10,
                background: pingStatus === "up"
                  ? "var(--t-status-connected)"
                  : pingStatus === "down"
                  ? "var(--t-status-error)"
                  : "var(--t-text-dim)",
              }}
            />
          </span>
        )}
      </div>
      <span
        className="text-xs font-medium text-center w-full truncate"
        style={{ color: "var(--t-text-primary)" }}
      >
        {displayName(connection)}
      </span>
      <span className="text-[10px]" style={{ color: "var(--t-text-dim)" }}>
        {connection.host}
      </span>
    </div>
  );
}
