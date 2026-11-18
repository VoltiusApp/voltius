import type { StatusTone } from "@/utils/statusTone";

/** Icon + colour per notification severity, used by the mobile notifications sheet. */
export const SEVERITY_ICONS: Record<string, string> = {
  info: "lucide:info",
  success: "lucide:circle-check-big",
  warning: "lucide:triangle-alert",
  error: "lucide:circle-x",
};

export const SEVERITY_COLORS: Record<string, string> = {
  info: "var(--t-accent)",
  success: "var(--t-status-connected)",
  warning: "var(--t-status-warning)",
  error: "var(--t-status-error)",
};

const SEVERITY_TONES: Record<string, StatusTone> = {
  info: "accent",
  success: "connected",
  warning: "warning",
  error: "error",
};

export const severityTone = (s: string): StatusTone => SEVERITY_TONES[s] ?? "accent";
export const severityIcon = (s: string) => SEVERITY_ICONS[s] ?? SEVERITY_ICONS.info;
export const severityColor = (s: string) => SEVERITY_COLORS[s] ?? SEVERITY_COLORS.info;

/** Badge text: 1–9, then "9+". */
export const badgeLabel = (count: number) => (count > 9 ? "9+" : String(count));
