import { useTranslation } from "react-i18next";

export type TunnelDotStatus = "active" | "error" | "idle";

const HUE: Record<TunnelDotStatus, { solid: string; ring: string }> = {
  active: { solid: "bg-green-500", ring: "text-green-500" },
  error: { solid: "bg-red-500", ring: "text-red-500" },
  idle: { solid: "bg-(--t-text-dim) opacity-40", ring: "text-(--t-text-dim) opacity-40" },
};

// Hue = our forward's health, fill = the remote end: a shape channel survives
// colour blindness. Unknown liveness renders solid, like a live one.
export function TunnelStatusDot({
  status,
  remoteListening,
  className = "",
}: {
  status: TunnelDotStatus;
  remoteListening?: boolean | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const hollow = remoteListening === false;
  const hue = HUE[status];
  return (
    <div
      title={hollow ? t("shared.tunnelStatus.noRemoteListener") : undefined}
      className={`w-3 h-3 shrink-0 flex items-center justify-center ${className}`}
    >
      {hollow ? (
        // SVG, not a CSS border: WebKit joins a border-radius ring from four
        // arcs, which rasterizes as a rounded square at this size.
        <svg viewBox="0 0 12 12" className={`w-3 h-3 ${hue.ring}`} aria-hidden="true">
          <circle cx="6" cy="6" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      ) : (
        <span className={`w-2 h-2 rounded-full transition-colors ${hue.solid}`} />
      )}
    </div>
  );
}
