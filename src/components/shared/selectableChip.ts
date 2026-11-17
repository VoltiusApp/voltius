import type { CSSProperties } from "react";

export const tint = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

export const selectableChipStyle = (active: boolean): CSSProperties => ({
  background: active ? tint("var(--t-accent)", 15) : "var(--t-bg-elevated)",
  border: `1px solid ${active ? "var(--t-accent)" : "var(--t-border)"}`,
  color: active ? "var(--t-accent)" : "var(--t-text-secondary)",
});
