import { useTranslation } from "react-i18next";

const AVATAR_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f59e0b", "#10b981", "#3b82f6", "#14b8a6",
];

export function avatarColor(name: string | undefined): string {
  const safe = name ?? "";
  let h = 0;
  for (let i = 0; i < safe.length; i++) h = safe.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/** Initials for a handle. Generated handles are `adjective-noun-NNNN` drawn
 *  from only 20 adjectives, so a single leading letter collides constantly —
 *  every `merry-*` user would render an identical "M" across 8 colours.
 *  Returns "?" for a missing or empty handle (e.g. an older server that
 *  omits `handle` before migration 035). */
export function handleInitials(handle: string | undefined): string {
  if (!handle) return "?";
  const words = handle.split(/[-_]/).filter((w) => /^[a-z]/i.test(w));
  const initials = words.slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  return initials || "?";
}

interface MiniAvatarProps {
  name: string | undefined;
  size?: number;
}

export function MiniAvatar({ name, size = 26 }: MiniAvatarProps) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold select-none shrink-0"
      style={{
        width: size,
        height: size,
        background: avatarColor(name),
        color: "#fff",
        fontSize: size * 0.32,
      }}
    >
      {handleInitials(name)}
    </div>
  );
}

interface AvatarOverflowProps {
  count: number;
  /** Edge length of the avatars this chip trails, in px. */
  size: number;
  /** Separator ring colour — should match the surface behind the stack. */
  ringColor?: string;
  /** Pulls the chip back over the preceding avatar. Off for spaced (non-stacked) rows. */
  overlap?: boolean;
}

/** The `+N` chip that closes an avatar row. */
export function AvatarOverflow({
  count, size, ringColor = "var(--t-bg-card)", overlap = true,
}: AvatarOverflowProps) {
  if (count <= 0) return null;
  return (
    <div
      className="flex items-center justify-center text-[10px] font-semibold rounded-full shrink-0"
      style={{
        marginLeft: overlap ? -(size * 0.37) : 0,
        zIndex: 0,
        width: size + 2,
        height: size + 2,
        background: "var(--t-bg-elevated)",
        border: `1.5px solid ${ringColor}`,
        color: "var(--t-text-dim)",
      }}
    >
      +{count}
    </div>
  );
}

interface AvatarStackProps {
  /** Named participants — when available, real initials are shown. */
  participants?: { name: string }[];
  /** Fallback total count when participant names are unknown. */
  count?: number;
  maxVisible?: number;
  size?: number;
  /** Background color used for the separator ring between avatars (should match card background). */
  ringColor?: string;
}

/** Stacked avatar row. Shows up to `maxVisible` named avatars, then a +N overflow chip.
 *  Falls back to a plain count badge when no names are available. */
export function AvatarStack({
  participants,
  count,
  maxVisible = 3,
  size = 22,
  ringColor = "var(--t-bg-card)",
}: AvatarStackProps) {
  const { t } = useTranslation();
  const total = participants?.length ?? count ?? 0;
  if (total === 0) return null;

  if (!participants || participants.length === 0) {
    return (
      <span
        className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
        style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-dim)" }}
      >
        {t("shared.avatarStack.participantCount", { count: total })}
      </span>
    );
  }

  const visible = participants.slice(0, maxVisible);
  const overflow = participants.length - maxVisible;

  return (
    <div className="flex items-center">
      {visible.map((p, i) => (
        <div
          key={p.name + i}
          title={p.name}
          style={{
            marginLeft: i === 0 ? 0 : -(size * 0.37),
            zIndex: maxVisible - i,
            borderRadius: "50%",
            boxShadow: `0 0 0 1.5px ${ringColor}`,
          }}
        >
          <MiniAvatar name={p.name} size={size} />
        </div>
      ))}
      <AvatarOverflow count={overflow} size={size} ringColor={ringColor} />
    </div>
  );
}
