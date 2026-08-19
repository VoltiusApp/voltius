import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { MiniAvatar } from "@/components/shared/AvatarStack";
import { StatusDot } from "@/components/shared/StatusDot";

interface PresenceAvatarProps {
  handle: string | undefined;
  size?: number;
  /** Draws the has-control marker: accent ring + pencil badge. */
  hasControl?: boolean;
  /** Draws the online dot. Suppressed by `hasControl` — both occupy the same corner. */
  online?: boolean;
  /** Pulses the online dot. */
  animate?: boolean;
  /** Overrides the composed `handle · has control` tooltip. */
  title?: string;
  className?: string;
}

/** One person, drawn the same way on every surface: identity-coloured initials,
 *  plus the shared status vocabulary (online, has-control). */
export function PresenceAvatar({
  handle, size = 22, hasControl = false, online = false, animate = false, title, className = "",
}: PresenceAvatarProps) {
  const { t } = useTranslation();
  const badge = Math.max(9, Math.round(size * 0.42));
  const composedTitle = title
    ?? (hasControl ? `${handle ?? "?"} · ${t("shared.presence.hasControl")}` : handle);

  return (
    <div
      className={`relative shrink-0 rounded-full ${className}`}
      title={composedTitle}
      style={hasControl ? { boxShadow: "0 0 0 2px var(--t-accent)" } : undefined}
    >
      <MiniAvatar name={handle} size={size} />
      {hasControl ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full flex items-center justify-center"
          style={{ width: badge, height: badge, background: "var(--t-accent)", color: "#fff" }}
        >
          <Icon icon="lucide:pencil" width={Math.round(badge * 0.6)} />
        </span>
      ) : (
        online && (
          <StatusDot
            color="var(--t-status-connected)"
            animate={animate}
            size={Math.max(7, Math.round(size * 0.28))}
          />
        )
      )}
    </div>
  );
}
