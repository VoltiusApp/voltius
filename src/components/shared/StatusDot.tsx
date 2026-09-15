import { STATUS_TONE_COLOR, type StatusTone } from "@/utils/statusTone";

type StatusDotSize = "sm" | "md";

interface StatusDotProps {
  tone: StatusTone;
  /** `sm` for dense rows and inline pills, `md` for cards, tabs and panels. */
  size?: StatusDotSize;
  /** A second channel beside hue: the thing is up but something behind it is not. */
  hollow?: boolean;
  /** Background colour to cut the dot out of when it overlaps an avatar. */
  halo?: string;
  /** Pins the dot to the bottom-right corner of a `relative` parent. */
  corner?: boolean;
  motion?: "pulse" | "ping" | "ping-fast";
  /** Tooltip and accessible name; without it the dot is decorative. */
  label?: string;
  className?: string;
}

const BOX: Record<StatusDotSize, string> = { sm: "size-1.5", md: "size-2" };

export function StatusDot({
  tone, size = "md", hollow = false, halo, corner = false, motion, label, className = "",
}: StatusDotProps) {
  const color = STATUS_TONE_COLOR[tone];
  const a11y = label ? { role: "img", "aria-label": label, title: label } : { "aria-hidden": true };
  const ping = motion === "ping" || motion === "ping-fast";
  return (
    <span
      {...a11y}
      className={`${corner ? "absolute bottom-0 right-0" : "relative"} inline-flex shrink-0 ${BOX[size]} ${motion === "pulse" ? "animate-pulse" : ""} ${className}`}
    >
      {ping && (
        <span
          className={`absolute inset-0 rounded-full group-hover:animate-ping ${motion === "ping-fast" ? "animate-ping" : "animate-ping-slow"}`}
          style={{ background: color }}
        />
      )}
      {hollow ? (
        // SVG, not a CSS border: WebKit joins a border-radius ring from four
        // arcs, which rasterizes as a rounded square at this size.
        <svg viewBox="0 0 8 8" overflow="visible" className="size-full" style={{ color }}>
          <circle cx="4" cy="4" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      ) : (
        <span
          className="relative size-full rounded-full transition-colors"
          style={{ background: color, boxShadow: halo ? `0 0 0 2px ${halo}` : undefined }}
        />
      )}
    </span>
  );
}
