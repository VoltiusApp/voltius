import { useTranslation } from "react-i18next";
import { StatusDot } from "@/components/shared/StatusDot";
import { tunnelStatusTone } from "@/utils/statusTone";

export type TunnelDotStatus = "active" | "error" | "idle";

// Hue = our forward's health, fill = the remote end: a shape channel survives
// colour blindness. Unknown liveness renders solid, like a live one.
export function TunnelStatusDot({
  status,
  remoteListening,
}: {
  status: TunnelDotStatus;
  remoteListening?: boolean | null;
}) {
  const { t } = useTranslation();
  const hollow = remoteListening === false;
  return (
    <StatusDot
      tone={tunnelStatusTone(status)}
      hollow={hollow}
      label={hollow ? t("shared.tunnelStatus.noRemoteListener") : undefined}
    />
  );
}
