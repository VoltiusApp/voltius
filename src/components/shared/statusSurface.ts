import type { CSSProperties } from "react";

export type StatusTone = "error" | "warning" | "connected" | "connecting";

/**
 * Tinted box for a status message. Inline rather than Tailwind classes on
 * purpose: the JIT only sees literal class strings, so an arbitrary value
 * built from a runtime token name emits no CSS and the fill silently
 * disappears.
 */
export function statusSurface(tone: StatusTone): CSSProperties {
  const color = `var(--t-status-${tone})`;
  return {
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    color,
    border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
  };
}
