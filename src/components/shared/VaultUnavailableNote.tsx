import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { statusSurface } from "./statusSurface";

/**
 * Shown on an editor whose stored secrets could not be read. Without it the
 * fields render empty, which is indistinguishable from a credential that was
 * never saved — and typing a guess into one replaces the real secret.
 */
export function VaultUnavailableNote({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${className ?? ""}`}
      style={statusSurface("warning")}
    >
      <Icon icon="lucide:shield-alert" width={14} className="mt-0.5 shrink-0" />
      <span>{t("shared.vaultUnavailable.note")}</span>
    </div>
  );
}
