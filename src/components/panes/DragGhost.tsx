import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useDragStore } from "@/stores/dragStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useSessionStore } from "@/stores/sessionStore";
import { getConnectionIcon, getConnectionIconColor } from "@/utils/icons";
import type { TerminalSession } from "@/types";
import { sessionLabel } from "@/utils/sessionLabel";

function sessionBadge(session: TerminalSession, t: TFunction): string {
  if (session.type === "ssh") return t("panes.badge.ssh");
  if (session.type === "serial") return t("panes.badge.serial");
  if (session.type === "multiplayer") return t("panes.badge.multiplayer");
  return t("panes.badge.local");
}

export function DragGhost() {
  const { t } = useTranslation();
  const isDragging = useDragStore((s) => s.isDragging);
  const currentX = useDragStore((s) => s.currentX);
  const currentY = useDragStore((s) => s.currentY);
  const sessionId = useDragStore((s) => s.sessionId);
  const dropTarget = useDragStore((s) => s.dropTarget);
  const session = useSessionStore((s) => s.sessions.find((sess) => sess.id === sessionId));
  const connections = useAllConnections();
  const connection = connections.find((c) => c.id === session?.connectionId);

  if (!isDragging || !session) return null;
  if (dropTarget?.type === "titlebar") return null;

  const connectionIcon = session.type === "ssh" && connection ? (connection.icon || connection.distro) : null;
  const distroIcon = connectionIcon ? getConnectionIcon(connectionIcon) : null;
  const icon = distroIcon ?? (session.type === "local" ? "lucide:terminal" : session.type === "serial" ? "lucide:ethernet-port" : "lucide:radio-tower");
  const iconBg = connectionIcon ? getConnectionIconColor(connectionIcon) : undefined;

  return (
    <div
      className="fixed z-9999 pointer-events-none select-none"
      style={{ left: currentX + 14, top: currentY + 10 }}
    >
      <div
        className="flex items-center gap-2 px-2 h-7 rounded-lg text-xs font-semibold"
        style={{
          background: "var(--t-bg-card)",
          border: "1px solid var(--t-accent)",
          color: "var(--t-text-primary)",
          boxShadow: "var(--t-elev-2)",
        }}
      >
        <span
          className="size-5 rounded-md flex items-center justify-center shrink-0"
          style={{ background: iconBg ?? "var(--t-bg-elevated)", color: iconBg ? "#fff" : "var(--t-text-secondary)" }}
        >
          <Icon icon={icon} width={13} />
        </span>
        <span className="truncate max-w-48">{sessionLabel(session)}</span>
        <span
          className="px-1.5 py-0.5 rounded-sm border text-[10px]"
          style={{ borderColor: "var(--t-border)", background: "var(--t-bg-elevated)" }}
        >
          {sessionBadge(session, t)}
        </span>
      </div>
    </div>
  );
}
