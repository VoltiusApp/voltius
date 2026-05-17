const AVATAR_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f59e0b", "#10b981", "#3b82f6", "#14b8a6",
];

export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

interface MiniAvatarProps {
  name: string;
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
        fontSize: size * 0.38,
      }}
    >
      {name[0]?.toUpperCase() ?? "?"}
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
  const total = participants?.length ?? count ?? 0;
  if (total === 0) return null;

  if (!participants || participants.length === 0) {
    return (
      <span
        className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
        style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-dim)" }}
      >
        {total} participant{total !== 1 ? "s" : ""}
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
      {overflow > 0 && (
        <div
          className="flex items-center justify-center text-[10px] font-semibold rounded-full shrink-0"
          style={{
            marginLeft: -(size * 0.37),
            zIndex: 0,
            width: size + 2,
            height: size + 2,
            background: "var(--t-bg-elevated)",
            border: `1.5px solid ${ringColor}`,
            color: "var(--t-text-dim)",
          }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
