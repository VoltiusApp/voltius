import { useTranslation } from "react-i18next";

export type TunnelDotStatus = "active" | "error" | "idle";

const HUE: Record<TunnelDotStatus, { solid: string; ring: string }> = {
  active: { solid: "bg-green-500", ring: "border-green-500" },
  error: { solid: "bg-red-500", ring: "border-red-500" },
  idle: { solid: "bg-(--t-text-dim) opacity-40", ring: "border-(--t-text-dim) opacity-40" },
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
      className={`w-2.5 h-2.5 shrink-0 flex items-center justify-center ${className}`}
    >
      <span
        className={`rounded-full transition-colors ${
          hollow ? `w-2.5 h-2.5 border-2 ${hue.ring}` : `w-2 h-2 ${hue.solid}`
        }`}
      />
    </div>
  );
}
